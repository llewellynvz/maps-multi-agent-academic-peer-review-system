import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { createDb, type SqliteConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { createGrobidClient } from '../src/ingest';
import { getCurrentFindings } from '../src/ledger';
import {
  artefactExists,
  type CompositeResult,
  type EngineDeps,
  readArtefact,
  runPhase1,
  runPhase2,
  runPhase3,
  runPhase4,
  runPhase5,
  runPhase6,
  runPhase7,
  runPhase8,
} from '../src/engine';
import { dataDir, fixturesDir, maraDbPath, mastraDbPath, repoRoot } from '../src/paths';
import { createCitationClient } from '../src/citations';
import { createDispatchRunner, createRegistry } from '../src/providers';
import { initTracing, startRun, withPhase } from '../src/tracing';
import { buildIngestMastra, resumeIngest, startIngest } from '../src/workflow';
import { type EnginePhaseStep, runEnginePhases } from '../src/worker/supervisor';

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

const PLOS_DOI = '10.1371/journal.pone.0275925';
const PLOS_PDF_URL = `https://journals.plos.org/plosone/article/file?id=${PLOS_DOI}&type=printable`;
const PDF_FIXTURE = resolve(fixturesDir(), 'plos-0275925.pdf');
const GROBID_URL = (process.env.GROBID_URL ?? 'http://127.0.0.1:8070').replace('localhost', '127.0.0.1');
const FINDING_ID_PATTERN = /^REV-[A-Z]{3,4}-\d{4}$/;

const failures: string[] = [];
const summary: Array<{ step: string; ok: boolean; detail: string }> = [];

function check(step: string, ok: boolean, detail: string): void {
  summary.push({ step, ok, detail });
  if (!ok) {
    failures.push(`${step}: ${detail}`);
  }
}

function loadEnv(): void {
  process.loadEnvFile(resolve(repoRoot, '.env'));
  const cert = process.env.AZURE_CLIENT_CERT_PEM_PATH;
  if (cert !== undefined && cert !== '' && !isAbsolute(cert)) {
    process.env.AZURE_CLIENT_CERT_PEM_PATH = resolve(repoRoot, cert);
  }
}

async function ensurePdfFixture(): Promise<void> {
  mkdirSync(fixturesDir(), { recursive: true });
  if (existsSync(PDF_FIXTURE)) {
    return;
  }
  console.log(`Downloading open-access fixture ${PLOS_DOI}`);
  const response = await fetch(PLOS_PDF_URL);
  if (!response.ok) {
    throw new Error(`Fixture download failed: HTTP ${response.status}`);
  }
  writeFileSync(PDF_FIXTURE, Buffer.from(await response.arrayBuffer()));
}

function langfuseHost(): string {
  return (process.env.LANGFUSE_HOST ?? '').replace(/\/+$/, '').replace('localhost', '127.0.0.1');
}

function langfuseAuthHeader(): string {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY ?? '';
  const secretKey = process.env.LANGFUSE_SECRET_KEY ?? '';
  return `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`;
}

interface TraceCheck {
  traceCount: number;
  generationCount: number;
  phaseSpanCount: number;
}

async function pollLangfuse(session: string): Promise<TraceCheck | null> {
  const host = langfuseHost();
  if (host === '') {
    return null;
  }
  const auth = langfuseAuthHeader();
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const listResponse = await fetch(`${host}/api/public/traces?sessionId=${encodeURIComponent(session)}`, {
        headers: { Authorization: auth },
      });
      if (listResponse.ok) {
        const body = (await listResponse.json()) as { data?: Array<{ id: string }> };
        const traces = body.data ?? [];
        let generationCount = 0;
        let phaseSpanCount = 0;
        for (const trace of traces.slice(0, 12)) {
          const detailResponse = await fetch(`${host}/api/public/traces/${trace.id}`, {
            headers: { Authorization: auth },
          });
          if (detailResponse.ok) {
            const detail = (await detailResponse.json()) as {
              observations?: Array<{ type?: string; name?: string }>;
            };
            for (const observation of detail.observations ?? []) {
              if (observation.type === 'GENERATION') {
                generationCount += 1;
              }
              if ((observation.name ?? '').startsWith('phase_')) {
                phaseSpanCount += 1;
              }
            }
          }
        }
        if (generationCount > 0 && phaseSpanCount > 0) {
          return { traceCount: traces.length, generationCount, phaseSpanCount };
        }
      }
    } catch {
      /* transient, retried below */
    }
    await new Promise((delay) => setTimeout(delay, 3000));
  }
  return null;
}

interface DispatchTotals {
  count: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
}

function dispatchTotals(sqlite: SqliteConnection, reviewId: string): DispatchTotals {
  const row = sqlite
    .prepare(
      "SELECT count(*) AS count, coalesce(sum(tokens_in),0) AS tokensIn, coalesce(sum(tokens_out),0) AS tokensOut, coalesce(sum(tokens_cached),0) AS tokensCached FROM dispatches WHERE review_id = ? AND status = 'success'",
    )
    .get(reviewId) as DispatchTotals;
  return row;
}

function checkpointSnapshot(sqlite: SqliteConnection, reviewId: string, phase: string): Record<string, unknown> | null {
  const row = sqlite
    .prepare('SELECT status, snapshot_json FROM phase_checkpoints WHERE review_id = ? AND phase = ?')
    .get(reviewId, phase) as { status: string; snapshot_json: string | null } | undefined;
  if (row === undefined || row.status !== 'completed') {
    return null;
  }
  return row.snapshot_json !== null ? (JSON.parse(row.snapshot_json) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  loadEnv();
  const tracing = initTracing({ env: process.env });
  mkdirSync(dataDir(), { recursive: true });
  await ensurePdfFixture();

  const { db, sqlite } = createDb(maraDbPath());
  runMigrations(db);
  const registry = createRegistry({ env: process.env });
  const runDispatch = createDispatchRunner({ db, registry });
  const citationClient = createCitationClient({
    cachePath: resolve(dataDir(), 'citation-cache.db'),
    ...(process.env.MARA_CONTACT_EMAIL !== undefined ? { contactEmail: process.env.MARA_CONTACT_EMAIL } : {}),
  });

  const grobid = createGrobidClient({ baseUrl: GROBID_URL });
  const grobidAlive = await grobid.isAlive();
  console.log(`GROBID at ${GROBID_URL}: ${grobidAlive ? 'alive' : 'unreachable (unpdf fallback, degraded parse)'}`);

  const reviewId = `slice-c-${Date.now()}`;
  const sessionId = `exercise-slice-c-${Date.now()}`;
  const nowIso = new Date().toISOString();
  sqlite
    .prepare('INSERT INTO reviews (id, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(reviewId, reviewId, 'queued', nowIso, nowIso);

  const engineDeps: EngineDeps = { db, runDispatch, citationClient };
  const startWall = Date.now();
  let engineError: string | null = null;
  let workflowStatus = 'not-run';

  await startRun(sessionId, async () => {
    const ingestMastra = buildIngestMastra({ db, runDispatch, ...(grobidAlive ? { grobid } : {}), mastraDbPath: mastraDbPath() });
    const started = await withPhase('ingest', () =>
      startIngest(ingestMastra, {
        reviewId,
        filePath: 'data/fixtures/plos-0275925.pdf',
        originalFilename: 'plos-0275925.pdf',
        mimeType: 'application/pdf',
      }),
    );
    check('ingest.suspends', started.status === 'suspended', `ingest status ${started.status}`);

    const resumed = await resumeIngest(ingestMastra, started.runId, {
      answers: { field: 'wellbeing science', journal: 'PLOS ONE' },
      preset: 'fast',
    });
    check('ingest.completes', resumed.status === 'success', `resume status ${resumed.status}`);

    try {
      await runEnginePhases({ deps: engineDeps, reviewId, phases: ENGINE_PHASES, shouldStop: () => null });
    } catch (error) {
      engineError = error instanceof Error ? error.message : String(error);
    }

    if (engineError === null) {
      const rerun = await runEnginePhases({ deps: engineDeps, reviewId, phases: ENGINE_PHASES, shouldStop: () => null });
      workflowStatus = rerun === 'completed' ? 'success' : rerun;
    }
  });

  const wallSeconds = ((Date.now() - startWall) / 1000).toFixed(1);
  citationClient.close();

  if (engineError !== null) {
    check('engine.completed', false, `engine threw: ${engineError}`);
  } else {
    check('engine.completed', true, 'phases 1-6 ran without throwing');
  }
  check('workflow.phase6', workflowStatus === 'success', `review-engine workflow status ${workflowStatus}`);
  check('checkpoint.phase6', checkpointSnapshot(sqlite, reviewId, 'engine_phase_6') !== null, 'engine_phase_6 checkpoint completed');

  const findings = getCurrentFindings(db, reviewId);
  check('ledger.nonEmpty', findings.length > 0, `${findings.length} current findings`);
  const badFindings = findings.filter(
    (finding) => !FINDING_ID_PATTERN.test(finding.id) || finding.manuscriptAnchor.trim().length === 0,
  );
  check('ledger.idsAndAnchors', badFindings.length === 0, `${badFindings.length} findings with a bad id or empty anchor`);

  const phase3 = checkpointSnapshot(sqlite, reviewId, 'engine_phase_3');
  const challengeLenses = Array.isArray(phase3?.challengeLenses) ? (phase3?.challengeLenses as string[]) : [];
  let blindThenChallenged = 0;
  for (const prefix of challengeLenses) {
    if (!artefactExists(reviewId, `p3-${prefix}-first`) || !artefactExists(reviewId, `p3-${prefix}-challenge`)) {
      continue;
    }
    const firstPass = readArtefact<{ challengeRound: unknown }>(reviewId, `p3-${prefix}-first`);
    if (firstPass.challengeRound === null) {
      blindThenChallenged += 1;
    }
  }
  check('phase3.blindThenChallenge', blindThenChallenged >= 2, `${blindThenChallenged} lenses ran a blind first pass then a challenge round`);

  const rubricCount = (
    sqlite.prepare('SELECT count(*) AS n FROM rubric_scores WHERE review_id = ?').get(reviewId) as { n: number }
  ).n;
  check('rubric.fifteen', rubricCount === 15, `${rubricCount} rubric_scores rows`);

  const phase5 = checkpointSnapshot(sqlite, reviewId, 'engine_phase_5');
  const entropyOk = typeof phase5?.consensusEntropy === 'number' && typeof phase5?.decisionStability === 'number';
  check(
    'swarm.metrics',
    entropyOk,
    entropyOk ? `entropy ${phase5?.consensusEntropy}, stability ${phase5?.decisionStability}` : 'swarm metrics missing',
  );

  let compositeValue = 'n/a';
  if (artefactExists(reviewId, 'p6-quality-composite')) {
    const composite = readArtefact<CompositeResult>(reviewId, 'p6-quality-composite');
    const weightsSum =
      composite.weights.evidenceGrounding +
      composite.weights.actionability +
      composite.weights.decisionStability +
      composite.weights.toneRisk +
      composite.weights.unsupportedClaim;
    compositeValue = composite.composite.toFixed(3);
    const inRange =
      Number.isFinite(composite.composite) &&
      composite.composite >= -0.1 &&
      composite.composite <= composite.positiveCeiling + 1e-9;
    check(
      'composite.present',
      Math.abs(weightsSum - 1) < 1e-9 && inRange,
      `composite ${compositeValue} (ceiling ${composite.positiveCeiling.toFixed(2)}), weights sum ${weightsSum.toFixed(2)}`,
    );
  } else {
    check('composite.present', false, 'p6-quality-composite artefact missing');
  }

  if (artefactExists(reviewId, 'p6-report')) {
    const report = readArtefact<{ citedFindingIds: string[] }>(reviewId, 'p6-report');
    const ledgerIds = new Set(findings.map((finding) => finding.id));
    const unresolved = report.citedFindingIds.filter((id) => !ledgerIds.has(id));
    check(
      'report.grounded',
      report.citedFindingIds.length > 0 && unresolved.length === 0,
      `${report.citedFindingIds.length} cited ids, ${unresolved.length} not in the ledger`,
    );
  } else {
    check('report.grounded', false, 'p6-report artefact missing');
  }

  const totals = dispatchTotals(sqlite, reviewId);
  const cachedShare = totals.tokensIn > 0 ? (totals.tokensCached / totals.tokensIn) * 100 : 0;

  try {
    await tracing.forceFlush();
  } catch (error) {
    console.log(`tracing flush warning: ${error instanceof Error ? error.message : String(error)}`);
  }
  const traceCheck = tracing.enabled ? await pollLangfuse(sessionId) : null;
  if (!tracing.enabled) {
    console.log('Langfuse tracing disabled; span assertion skipped');
  } else {
    check('langfuse.spans', traceCheck !== null, traceCheck !== null ? `${traceCheck.generationCount} generations, ${traceCheck.phaseSpanCount} phase spans` : 'no trace with phase spans and generations found');
  }

  console.log('\n=== slice-C exercise summary ===');
  const width = summary.reduce((max, row) => Math.max(max, row.step.length), 0);
  for (const row of summary) {
    console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.step.padEnd(width)}  ${row.detail}`);
  }

  console.log('\n=== run analytics ===');
  console.log(`review id:        ${reviewId}`);
  console.log(`session id:       ${sessionId}`);
  console.log(`preset:           fast`);
  console.log(`dispatches:       ${totals.count}`);
  console.log(`tokens in/out:    ${totals.tokensIn} / ${totals.tokensOut}`);
  console.log(`cached share:     ${cachedShare.toFixed(1)}%`);
  console.log(`composite:        ${compositeValue}`);
  console.log(`current findings: ${findings.length}`);
  console.log(`wall clock:       ${wallSeconds}s`);
  if (traceCheck !== null) {
    console.log(`langfuse traces:  ${traceCheck.traceCount} (${traceCheck.generationCount} generations, ${traceCheck.phaseSpanCount} phase spans)`);
  }

  sqlite.close();
  await tracing.shutdown();

  if (failures.length > 0) {
    console.log(`\n${failures.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll slice-C exercise assertions passed.');
  process.exit(0);
}

await main();
