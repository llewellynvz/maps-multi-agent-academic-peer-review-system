import { isAbsolute, resolve } from 'node:path';
import type { Mastra } from '@mastra/core';
import { createCitationClient, defaultFetch } from './citations';
import { createEgressController } from './security';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { createRotatingLog } from './logging/rotating-log';
import { citationCachePath, maraDbPath, mastraDbPath, repoRoot } from './paths';
import {
  createCostCeilingGate,
  type EngineDeps,
  runPhase1,
  runPhase2,
  runPhase3,
  runPhase4,
  runPhase5,
  runPhase6,
  runPhase7,
  runPhase8,
} from './engine';
import { createGrobidClient } from './ingest';
import { createDispatchRunner, createRegistry, getEnv } from './providers';
import { contentCaptureAllowed, initTracing, startRun } from './tracing';
import { getManuscript, getReviewOptions, maxEventSeq, mergeReviewOptions, pauseReview, recordEngineFailure } from './workflow/repo';
import { buildIngestMastra, resumeIngest, startIngest } from './workflow';
import { readSetting } from './data/settings-store';
import { announceFindings } from './worker/announce';
import { WorkerRunner, type EngineResult, type IngestOutcome } from './worker/runner';
import { type EngineOutcome, type EnginePhaseStep, runEnginePhases, superviseDispatch } from './worker/supervisor';

const ENGINE_PHASES: Array<EnginePhaseStep<EngineDeps>> = [
  { name: 'phase_1', run: runPhase1 },
  { name: 'phase_2', run: runPhase2 },
  { name: 'phase_3', run: runPhase3 },
  { name: 'phase_4', run: runPhase4 },
  { name: 'phase_5', run: runPhase5 },
  { name: 'phase_6', run: runPhase6 },
  { name: 'phase_7', run: runPhase7 },
  { name: 'phase_8', run: runPhase8 },
];

function loadEnv(): void {
  try {
    process.loadEnvFile(resolve(repoRoot, '.env'));
  } catch {}
  const cert = process.env.AZURE_CLIENT_CERT_PEM_PATH;
  if (cert !== undefined && cert !== '' && !isAbsolute(cert)) {
    process.env.AZURE_CLIENT_CERT_PEM_PATH = resolve(repoRoot, cert);
  }
}

const fileLog = createRotatingLog('worker');
function log(message: string): void {
  process.stdout.write(`[worker] ${new Date().toISOString()} ${message}\n`);
  fileLog.write('info', 'worker', message);
}

function mapIngest(summary: { status: string; result: unknown }): IngestOutcome {
  if (summary.status === 'suspended') {
    return 'suspended';
  }
  const result = summary.result as { halted?: boolean } | null;
  return result?.halted === true ? 'halted' : 'ingested';
}

async function main(): Promise<void> {
  loadEnv();
  const tracing = initTracing({ env: process.env });
  const { db, sqlite } = createDb(maraDbPath());
  runMigrations(db);

  const registry = createRegistry({ env: process.env });
  const contentAllowed = await contentCaptureAllowed(process.env);
  log(
    contentAllowed
      ? 'Langfuse content capture is permitted (host resolves to loopback); prompts and completions are recorded only when the setting is on'
      : 'Langfuse content capture is disabled; traces carry no prompt or completion text',
  );
  const baseDispatch = createDispatchRunner({ db, registry, contentCaptureAllowed: contentAllowed });
  const dispatchTimeoutMs = Number.parseInt(process.env.MARA_DISPATCH_TIMEOUT_MS ?? '300000', 10);
  const runDispatch = superviseDispatch(baseDispatch, {
    timeoutMs: Number.isFinite(dispatchTimeoutMs) ? dispatchTimeoutMs : 300000,
    onStale: (reason) => log(`stale dispatch (${reason}), re-issuing from checkpoint`),
  });

  const egress = createEgressController(defaultFetch);
  const citationClient = createCitationClient({
    fetchImpl: egress.fetch,
    cachePath: citationCachePath(),
    ...(process.env.MARA_CONTACT_EMAIL !== undefined ? { contactEmail: process.env.MARA_CONTACT_EMAIL } : {}),
  });
  const engineDeps: EngineDeps = { db, runDispatch, citationClient, egress, preDispatch: createCostCeilingGate({ db }) };

  const grobidUrl = (getEnv(process.env, 'GROBID_URL') ?? 'http://127.0.0.1:8070').replace('localhost', '127.0.0.1');
  const grobid = createGrobidClient({ baseUrl: grobidUrl });
  log(`GROBID configured at ${grobidUrl}; liveness is probed per review, and a PDF that cannot be structured halts for retry`);

  const presetDefault = readSetting<string>(db, 'preset_default') ?? undefined;
  const ingestMastra: Mastra = buildIngestMastra({
    db,
    runDispatch,
    grobid,
    ...(presetDefault !== undefined ? { presetDefault } : {}),
    mastraDbPath: mastraDbPath(),
  });

  const runner = new WorkerRunner({
    client: { db, sqlite },
    pollMs: Number.parseInt(process.env.MARA_WORKER_POLL_MS ?? '500', 10),
    ...(process.env.MARA_AWAITING_INPUT_TIMEOUT_MS !== undefined &&
    Number.parseInt(process.env.MARA_AWAITING_INPUT_TIMEOUT_MS, 10) > 0
      ? { awaitingInputTimeoutMs: Number.parseInt(process.env.MARA_AWAITING_INPUT_TIMEOUT_MS, 10) }
      : {}),
    onLog: log,
    processors: {
      startIngest: async (reviewId, args): Promise<IngestOutcome> => {
        const manuscript = getManuscript(db, reviewId);
        const filePath = typeof args.filePath === 'string' ? args.filePath : manuscript?.blobPath;
        if (filePath === undefined) {
          throw new Error(`no manuscript blob for review ${reviewId}`);
        }
        const originalFilename = typeof args.originalFilename === 'string' ? args.originalFilename : 'manuscript';
        const mimeType = typeof args.mimeType === 'string' ? args.mimeType : 'application/pdf';
        let summary!: { runId: string; status: string; result: unknown };
        await startRun(reviewId, async () => {
          summary = await startIngest(ingestMastra, { reviewId, filePath, originalFilename, mimeType });
        });
        mergeReviewOptions(db, reviewId, { ingestRunId: summary.runId });
        return mapIngest(summary);
      },
      ingestResumable: async (reviewId): Promise<boolean> => {
        const options = getReviewOptions(db, reviewId);
        const runId = typeof options.ingestRunId === 'string' ? options.ingestRunId : null;
        if (runId === null) {
          return false;
        }
        try {
          const run = await ingestMastra.getWorkflow('ingest').getWorkflowRunById(runId);
          return run !== null;
        } catch {
          return false;
        }
      },
      resumeIngest: async (reviewId, answers, preset): Promise<IngestOutcome> => {
        const options = getReviewOptions(db, reviewId);
        const runId = typeof options.ingestRunId === 'string' ? options.ingestRunId : null;
        if (runId === null) {
          throw new Error(`no ingest run id recorded for review ${reviewId}`);
        }
        let summary!: { status: string; result: unknown };
        await startRun(reviewId, async () => {
          summary = await resumeIngest(ingestMastra, runId, { answers, ...(preset !== undefined ? { preset } : {}) });
        });
        return mapIngest(summary);
      },
      runEngine: async (reviewId, shouldStop): Promise<EngineResult> => {
        const engineStartSeq = maxEventSeq(db, reviewId);
        try {
          let outcome: EngineOutcome = 'completed';
          const announced = new Set<string>();
          await startRun(reviewId, async () => {
            outcome = await runEnginePhases({
              deps: engineDeps,
              reviewId,
              phases: ENGINE_PHASES,
              shouldStop,
              onStale: (info) => log(`phase ${info.phase} stale (${info.reason}), restart ${info.restart}`),
              onPause: (info) => {
                log(`phase ${info.phase} paused (${info.reason})`);
                pauseReview(db, reviewId, { reason: info.reason, phase: info.phase, ...(info.detail !== undefined ? { detail: info.detail } : {}) });
              },
              afterPhase: () => announceFindings(db, reviewId, announced),
            });
          });
          return outcome;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(`engine error for ${reviewId}: ${message}`);
          if (shouldStop() === 'shutdown') {
            return 'stopped';
          }
          recordEngineFailure(db, reviewId, error instanceof Error ? error.name : 'Error', engineStartSeq);
          return 'failed';
        } finally {
          await tracing.forceFlush().catch(() => undefined);
        }
      },
    },
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log(`received ${signal}, shutting down after the current phase`);
    await runner.stop();
    citationClient.close();
    sqlite.close();
    await tracing.shutdown().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  runner.start();
  log(`worker started, polling ${maraDbPath()}`);
}

void main();
