import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { reviews } from '../src/db/schema';
import {
  createDispatchRunner,
  createRegistry,
  type DispatchInput,
  type DispatchResult,
} from '../src/providers';
import { createCitationClient, type VerifyReferenceResult } from '../src/citations';
import { initTracing, startRun, withPhase } from '../src/tracing';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
process.loadEnvFile(resolve(repoRoot, '.env'));

const certPath = process.env.AZURE_CLIENT_CERT_PEM_PATH;
if (certPath !== undefined && certPath !== '' && !isAbsolute(certPath)) {
  process.env.AZURE_CLIENT_CERT_PEM_PATH = resolve(repoRoot, certPath);
}

const sessionId = `exercise-slice-a-${Date.now()}`;
const failures: string[] = [];

interface DispatchRow {
  label: string;
  result?: DispatchResult;
  error?: string;
}

const rows: DispatchRow[] = [];

function buildSharedPrefix(): string {
  const sentence =
    'The MARA peer-review pipeline evaluates psychology and wellbeing-science manuscripts against a fifteen-criterion rubric, grounding every recommendation in an append-only evidence ledger anchored to the submitted text. ';
  let prefix =
    'You are a MARA slice-A exercise fixture. Ignore the padding below; it exists only to build a cacheable prompt prefix.\n\n';
  while (prefix.length < 12000) {
    prefix += sentence;
  }
  return prefix;
}

async function main(): Promise<void> {
  const tracing = initTracing({ env: process.env });

  const dbPath = resolve(repoRoot, 'data', 'mara.db');
  const { db, sqlite } = createDb(dbPath);
  runMigrations(db);
  const now = new Date().toISOString();
  db.insert(reviews).values({ id: sessionId, slug: sessionId, createdAt: now, updatedAt: now }).run();

  const registry = createRegistry({ env: process.env });
  const runDispatch = createDispatchRunner({ db, registry });

  const contactEmail = process.env.MARA_CONTACT_EMAIL;
  const citations = createCitationClient({
    cachePath: resolve(repoRoot, 'data', 'citation-cache.db'),
    ...(contactEmail !== undefined ? { contactEmail } : {}),
    ...(process.env.OPENALEX_API_KEY !== undefined ? { openAlexApiKey: process.env.OPENALEX_API_KEY } : {}),
    ...(process.env.SEMANTIC_SCHOLAR_API_KEY !== undefined
      ? { semanticScholarApiKey: process.env.SEMANTIC_SCHOLAR_API_KEY }
      : {}),
  });

  const record = async (label: string, input: DispatchInput): Promise<DispatchResult | null> => {
    try {
      const result = await runDispatch(input);
      rows.push({ label, result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rows.push({ label, error: message });
      failures.push(`${label} dispatch failed: ${message}`);
      return null;
    }
  };

  const sharedPrefix = buildSharedPrefix();
  const objectSchema = z.object({ verdict: z.enum(['ok', 'fail']), reason: z.string() });
  let objectResult: DispatchResult | null = null;
  let secondFrontier: DispatchResult | null = null;

  await startRun(sessionId, async () => {
    await withPhase('phase-frontier', async () => {
      await record('frontier-prefix-1', {
        reviewId: sessionId,
        phase: 'phase-frontier',
        agent: 'exercise-frontier',
        promptVersion: 'v1',
        role: 'frontier',
        parts: { system: sharedPrefix, prompt: 'Reply with exactly: MARA slice A frontier one.' },
      });
      secondFrontier = await record('frontier-prefix-2', {
        reviewId: sessionId,
        phase: 'phase-frontier',
        agent: 'exercise-frontier',
        promptVersion: 'v1',
        role: 'frontier',
        parts: { system: sharedPrefix, prompt: 'Reply with exactly: MARA slice A frontier two.' },
      });
      await record('cheap', {
        reviewId: sessionId,
        phase: 'phase-frontier',
        agent: 'exercise-cheap',
        promptVersion: 'v1',
        role: 'cheap',
        parts: { prompt: 'In one short sentence, say the review pipeline is running.' },
      });
      objectResult = await record('frontier-object', {
        reviewId: sessionId,
        phase: 'phase-frontier',
        agent: 'exercise-structured',
        promptVersion: 'v1',
        role: 'frontier',
        schema: objectSchema,
        parts: { prompt: "A preflight check succeeded. Return verdict 'ok' and a one-line reason." },
      });
    });

    await withPhase('phase-local', async () => {
      await record('local', {
        reviewId: sessionId,
        phase: 'phase-local',
        agent: 'exercise-local',
        promptVersion: 'v1',
        role: 'local',
        parts: { prompt: 'Reply with a single word: ready.' },
      });
    });
  });

  try {
    await tracing.forceFlush();
  } catch (error) {
    console.log(`tracing flush warning: ${error instanceof Error ? error.message : String(error)}`);
  }

  const seligman = await citations.verifyReference({
    title: 'Positive psychology: An introduction',
    authors: ['Seligman', 'Csikszentmihalyi'],
    year: 2000,
    doi: '10.1037/0003-066X.55.1.5',
  });
  const fabricated = await citations.verifyReference({
    title: 'The quantum mechanics of team flourishing',
    authors: ['Van Der Fakename'],
    year: 2019,
    doi: '10.9999/fake.12345',
  });
  citations.close();

  const traceId = rows.find((row) => row.result?.langfuseTraceId)?.result?.langfuseTraceId ?? null;
  const traceCheck = tracing.enabled ? await pollLangfuse(sessionId, traceId) : null;

  printSummary({ seligman, fabricated, secondFrontier, objectResult, objectSchema, traceCheck, tracingEnabled: tracing.enabled });

  sqlite.close();
  await tracing.shutdown();

  if (failures.length > 0) {
    console.log('\nFAILED assertions:');
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('\nAll slice-A acceptance assertions passed.');
}

interface TraceCheck {
  traceId: string;
  generationCount: number;
}

function langfuseAuthHeader(): string {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY ?? '';
  const secretKey = process.env.LANGFUSE_SECRET_KEY ?? '';
  return `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`;
}

function langfuseHost(): string {
  return (process.env.LANGFUSE_HOST ?? '').replace(/\/+$/, '').replace('localhost', '127.0.0.1');
}

async function pollLangfuse(session: string, expectedTraceId: string | null): Promise<TraceCheck | null> {
  const host = langfuseHost();
  const auth = langfuseAuthHeader();
  if (host === '') {
    return null;
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const listResponse = await fetch(`${host}/api/public/traces?sessionId=${encodeURIComponent(session)}`, {
        headers: { Authorization: auth },
      });
      if (listResponse.ok) {
        const body = (await listResponse.json()) as { data?: Array<{ id: string }> };
        const traceId = body.data?.[0]?.id ?? expectedTraceId;
        if (traceId !== null && traceId !== undefined) {
          const detailResponse = await fetch(`${host}/api/public/traces/${traceId}`, {
            headers: { Authorization: auth },
          });
          if (detailResponse.ok) {
            const detail = (await detailResponse.json()) as { observations?: Array<{ type?: string }> };
            const generationCount = (detail.observations ?? []).filter((observation) => observation.type === 'GENERATION').length;
            if (generationCount > 0) {
              return { traceId, generationCount };
            }
          }
        }
      }
    } catch {
      /* transient; retried below */
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
  }
  return null;
}

interface SummaryInput {
  seligman: VerifyReferenceResult;
  fabricated: VerifyReferenceResult;
  secondFrontier: DispatchResult | null;
  objectResult: DispatchResult | null;
  objectSchema: z.ZodType;
  traceCheck: TraceCheck | null;
  tracingEnabled: boolean;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function printSummary(input: SummaryInput): void {
  console.log(`\nRun session: ${sessionId}`);
  console.log('\nDispatch summary:');
  const header = [
    pad('label', 20),
    pad('provider', 10),
    pad('model', 16),
    pad('in', 8),
    pad('out', 8),
    pad('cached', 8),
    pad('reason', 8),
    pad('ms', 8),
  ].join(' ');
  console.log(header);
  for (const row of rows) {
    if (row.result === undefined) {
      console.log(`${pad(row.label, 20)} ERROR ${row.error ?? ''}`);
      continue;
    }
    const result = row.result;
    console.log(
      [
        pad(row.label, 20),
        pad(result.provider, 10),
        pad(result.model, 16),
        pad(String(result.tokens.inputTokens), 8),
        pad(String(result.tokens.outputTokens), 8),
        pad(String(result.tokens.cachedTokens), 8),
        pad(String(result.tokens.reasoningTokens), 8),
        pad(String(result.latencyMs), 8),
      ].join(' '),
    );
  }

  const second = input.secondFrontier;
  if (second !== null && second.tokens.inputTokens > 0) {
    const share = second.tokens.cachedTokens / second.tokens.inputTokens;
    console.log(`\nRepeated-prefix cached-token share (frontier-prefix-2): ${(share * 100).toFixed(1)}%`);
    if (second.tokens.cachedTokens <= 0) {
      failures.push('Repeated-prefix call showed no cached input tokens');
    }
  } else {
    failures.push('Second frontier dispatch did not complete, cannot measure prompt caching');
  }

  if (input.objectResult === null || input.objectResult.object === undefined) {
    failures.push('Structured-output dispatch produced no object');
  } else {
    const parsed = input.objectSchema.safeParse(input.objectResult.object);
    console.log(`\nStructured output: ${JSON.stringify(input.objectResult.object)} (schema valid: ${parsed.success})`);
    if (!parsed.success) {
      failures.push('Structured-output object did not satisfy the schema');
    }
  }

  console.log('\nCitation checks:');
  console.log(
    `  Seligman & Csikszentmihalyi 2000: status=${input.seligman.status} source=${input.seligman.source ?? 'none'} confidence=${input.seligman.confidence}`,
  );
  console.log(
    `  Fabricated reference: status=${input.fabricated.status} source=${input.fabricated.source ?? 'none'} confidence=${input.fabricated.confidence}`,
  );
  if (input.seligman.status !== 'verified') {
    failures.push(`Known-good DOI did not verify (got ${input.seligman.status})`);
  }
  if (input.fabricated.status !== 'not_found') {
    failures.push(`Fabricated reference did not return not_found (got ${input.fabricated.status})`);
  }

  console.log('\nLangfuse:');
  if (!input.tracingEnabled) {
    console.log('  tracing disabled (Langfuse env not configured), trace assertion skipped');
  } else if (input.traceCheck === null) {
    console.log('  no trace with generations found for this session');
    failures.push('Langfuse trace with generations was not found for the run session');
  } else {
    console.log(`  trace id: ${input.traceCheck.traceId}`);
    console.log(`  generation count: ${input.traceCheck.generationCount}`);
  }
}

await main();
