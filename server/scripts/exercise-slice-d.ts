import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import JSZip from 'jszip';
import { createDb, type SqliteConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { createGrobidClient } from '../src/ingest';
import { getCurrentFindings } from '../src/ledger';
import {
  artefactExists,
  type EngineDeps,
  loadBannedVerdictTerms,
  readArtefact,
  runReviewEngine,
} from '../src/engine';
import { dataDir, fixturesDir, maraDbPath, mastraDbPath, repoRoot } from '../src/paths';
import { createCitationClient } from '../src/citations';
import { createDispatchRunner, createRegistry } from '../src/providers';
import { initTracing, startRun, withPhase } from '../src/tracing';
import { manuscriptBlobPath } from '../src/workflow/storage';
import { buildIngestMastra, buildReviewEngineMastra, resumeIngest, startIngest, startReviewEngine } from '../src/workflow';

const PLOS_DOI = '10.1371/journal.pone.0275925';
const PLOS_PDF_URL = `https://journals.plos.org/plosone/article/file?id=${PLOS_DOI}&type=printable`;
const PDF_FIXTURE = resolve(fixturesDir(), 'plos-0275925.pdf');
const GROBID_URL = (process.env.GROBID_URL ?? 'http://127.0.0.1:8070').replace('localhost', '127.0.0.1');
const FINDING_ID_TOKEN = /REV-[A-Z]{3,4}-\d{4}/g;

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
  phase7Spans: number;
  phase8Spans: number;
  scoreMarkers: number;
  traceId: string | null;
}

async function pollLangfuse(session: string): Promise<TraceCheck | null> {
  const host = langfuseHost();
  if (host === '') {
    return null;
  }
  const auth = langfuseAuthHeader();
  const scoreKeys = ['mara.critic_verdict', 'mara.rubric_average', 'mara.recommendation', 'mara.composite'];
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const listResponse = await fetch(`${host}/api/public/traces?sessionId=${encodeURIComponent(session)}`, {
        headers: { Authorization: auth },
      });
      if (listResponse.ok) {
        const body = (await listResponse.json()) as { data?: Array<{ id: string }> };
        const traces = body.data ?? [];
        let generationCount = 0;
        let phase7Spans = 0;
        let phase8Spans = 0;
        let scoreMarkers = 0;
        let traceId: string | null = null;
        for (const trace of traces.slice(0, 16)) {
          const detailResponse = await fetch(`${host}/api/public/traces/${trace.id}`, { headers: { Authorization: auth } });
          if (!detailResponse.ok) {
            continue;
          }
          const detail = (await detailResponse.json()) as { observations?: Array<Record<string, unknown>> };
          for (const observation of detail.observations ?? []) {
            if (observation.type === 'GENERATION') {
              generationCount += 1;
            }
            const name = (observation.name as string | undefined) ?? '';
            if (name === 'phase_7') {
              phase7Spans += 1;
            }
            if (name === 'phase_8') {
              phase8Spans += 1;
            }
            const serialized = JSON.stringify(observation.metadata ?? {});
            if (scoreKeys.some((key) => serialized.includes(key))) {
              scoreMarkers += 1;
              traceId = trace.id;
            }
          }
        }
        if (generationCount > 0 && phase7Spans > 0 && phase8Spans > 0) {
          return { traceCount: traces.length, generationCount, phase7Spans, phase8Spans, scoreMarkers, traceId };
        }
      }
    } catch {
      /* transient */
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
  return sqlite
    .prepare(
      "SELECT count(*) AS count, coalesce(sum(tokens_in),0) AS tokensIn, coalesce(sum(tokens_out),0) AS tokensOut, coalesce(sum(tokens_cached),0) AS tokensCached FROM dispatches WHERE review_id = ? AND status = 'success'",
    )
    .get(reviewId) as DispatchTotals;
}

function checkpointSnapshot(sqlite: SqliteConnection, reviewId: string, phase: string): Record<string, unknown> | null {
  const row = sqlite
    .prepare('SELECT status, gate_verdict, fix_cycle_count, snapshot_json FROM phase_checkpoints WHERE review_id = ? AND phase = ?')
    .get(reviewId, phase) as { status: string; gate_verdict: string | null; fix_cycle_count: number; snapshot_json: string | null } | undefined;
  if (row === undefined) {
    return null;
  }
  const snapshot = row.snapshot_json !== null ? (JSON.parse(row.snapshot_json) as Record<string, unknown>) : {};
  return { ...snapshot, __status: row.status, __gate: row.gate_verdict, __cycles: row.fix_cycle_count };
}

async function docxText(reviewId: string, relativePath: string): Promise<string | null> {
  const path = manuscriptBlobPath(reviewId, relativePath);
  if (!existsSync(path)) {
    return null;
  }
  const zip = await JSZip.loadAsync(readFileSync(path));
  const doc = zip.file('word/document.xml');
  if (doc === null) {
    return null;
  }
  return doc.async('string');
}

function findExistingPhase6Review(sqlite: SqliteConnection): string | null {
  const rows = sqlite
    .prepare(
      "SELECT review_id FROM phase_checkpoints WHERE phase = 'engine_phase_6' AND status = 'completed' ORDER BY updated_at DESC LIMIT 25",
    )
    .all() as Array<{ review_id: string }>;
  for (const row of rows) {
    const phase8 = sqlite
      .prepare("SELECT status FROM phase_checkpoints WHERE review_id = ? AND phase = 'engine_phase_8'")
      .get(row.review_id) as { status: string } | undefined;
    if (phase8?.status === 'completed') {
      continue;
    }
    if (artefactExists(row.review_id, 'p6-report') && artefactExists(row.review_id, 'p5-swarm')) {
      return row.review_id;
    }
  }
  return null;
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
  const engineDeps: EngineDeps = { db, runDispatch, citationClient };

  const reused = findExistingPhase6Review(sqlite);
  const sessionId = `exercise-slice-d-${Date.now()}`;
  const startWall = Date.now();
  let reviewId = reused ?? `slice-d-${Date.now()}`;
  let engineError: string | null = null;
  let workflowStatus = 'not-run';

  await startRun(sessionId, async () => {
    if (reused === null) {
      const grobid = createGrobidClient({ baseUrl: GROBID_URL });
      const grobidAlive = await grobid.isAlive();
      console.log(`GROBID at ${GROBID_URL}: ${grobidAlive ? 'alive' : 'unreachable (unpdf fallback, degraded parse)'}`);
      const nowIso = new Date().toISOString();
      sqlite.prepare('INSERT INTO reviews (id, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(reviewId, reviewId, 'queued', nowIso, nowIso);
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
    } else {
      console.log(`Reusing phase-6-complete review ${reused} for the phase 7-8 run.`);
      check('reuse.review', true, `reused ${reused}`);
    }

    try {
      await runReviewEngine(engineDeps, reviewId);
    } catch (error) {
      engineError = error instanceof Error ? error.message : String(error);
    }

    if (engineError === null) {
      const engineMastra = buildReviewEngineMastra({ db, runDispatch, citationClient, mastraDbPath: mastraDbPath() });
      const workflowRun = await startReviewEngine(engineMastra, reviewId);
      workflowStatus = workflowRun.status;
    }
  });

  const wallSeconds = ((Date.now() - startWall) / 1000).toFixed(1);
  citationClient.close();

  check('engine.completed', engineError === null, engineError === null ? 'phases 1-8 ran without throwing' : `engine threw: ${engineError}`);
  check('workflow.idempotent', workflowStatus === 'success', `review-engine workflow status ${workflowStatus}`);

  const gate = checkpointSnapshot(sqlite, reviewId, 'engine_phase_7');
  const released = gate?.released === true;
  const criticVerdict = typeof gate?.verdict === 'string' ? (gate.verdict as string) : (gate?.__gate as string | null) ?? 'unknown';
  const fixCycles = typeof gate?.__cycles === 'number' ? (gate.__cycles as number) : 0;
  check('gate.verdict', gate !== null && gate.__gate !== null, `gate verdict ${criticVerdict}, released ${released}, fix cycles ${fixCycles}`);
  if (criticVerdict !== 'pass') {
    const capOk = fixCycles <= 2;
    const arbitrationLogged = fixCycles < 2 || (sqlite.prepare("SELECT count(*) AS n FROM review_events WHERE review_id = ? AND kind = 'arbitration'").get(reviewId) as { n: number }).n > 0;
    check('gate.capAndArbitration', capOk && arbitrationLogged, `fix cycles ${fixCycles} (<=2), arbitration logged when capped: ${arbitrationLogged}`);
  } else {
    check('gate.capAndArbitration', true, 'pass on first gate, no fix cycles required');
  }

  const rubricFinal = (sqlite.prepare("SELECT count(*) AS n FROM rubric_scores WHERE review_id = ? AND state = 'final'").get(reviewId) as { n: number }).n;
  check('rubric.finalRows', rubricFinal === 15, `${rubricFinal} final rubric rows`);

  const findings = getCurrentFindings(db, reviewId);
  const editorOnlyIds = new Set(findings.filter((finding) => finding.scope === 'editor_only').map((finding) => finding.id));
  const ledgerIds = new Set(findings.map((finding) => finding.id));
  const bannedTerms = loadBannedVerdictTerms();

  let rubricAverage = 'n/a';
  let recommendation = 'n/a';
  let composite = 'n/a';
  if (artefactExists(reviewId, 'p7-gate-record')) {
    const record = readArtefact<{ rubricAverage?: number; recommendation?: string }>(reviewId, 'p7-gate-record');
    rubricAverage = typeof record.rubricAverage === 'number' ? record.rubricAverage.toFixed(1) : 'n/a';
    recommendation = record.recommendation ?? 'n/a';
  }
  if (artefactExists(reviewId, 'p8-quality-metrics')) {
    composite = readArtefact<{ composite: number }>(reviewId, 'p8-quality-metrics').composite.toFixed(3);
  }

  if (released) {
    const authorText = await docxText(reviewId, 'output/author-letter.docx');
    const notesText = await docxText(reviewId, 'output/reviewer-private-notes.docx');
    check('deliverable.authorDocx', authorText !== null, authorText !== null ? 'author-letter.docx unzips with document.xml' : 'author-letter.docx missing or unreadable');
    check('deliverable.notesDocx', notesText !== null, notesText !== null ? 'reviewer-private-notes.docx unzips' : 'reviewer-private-notes.docx missing');

    if (authorText !== null) {
      const brandOk = ['Inter', 'JetBrains Mono', '006D7C', '008DA1', 'A7D12B', 'FEFCF5'].every((token) => authorText.includes(token));
      check('deliverable.brand', brandOk, brandOk ? 'brand fonts and palette present in styles' : 'brand tokens missing from document.xml');

      const idsInDoc = new Set<string>();
      let match = FINDING_ID_TOKEN.exec(authorText);
      while (match !== null) {
        idsInDoc.add(match[0]);
        match = FINDING_ID_TOKEN.exec(authorText);
      }
      FINDING_ID_TOKEN.lastIndex = 0;
      const leaked = [...idsInDoc].filter((id) => editorOnlyIds.has(id));
      const ungrounded = [...idsInDoc].filter((id) => !ledgerIds.has(id));
      const lower = authorText.toLowerCase();
      const bannedHits = bannedTerms.filter((term) => lower.includes(term));
      check('deliverable.noEditorLeak', leaked.length === 0, `${leaked.length} editor-only ids in author letter`);
      check('deliverable.grounded', ungrounded.length === 0, `${ungrounded.length} ungrounded ids in author letter`);
      check('deliverable.noBannedTerms', bannedHits.length === 0, bannedHits.length === 0 ? 'no banned verdict terms' : `banned terms: ${bannedHits.join(', ')}`);
    }

    const deliverableRows = (sqlite.prepare('SELECT count(*) AS n FROM deliverables WHERE review_id = ? AND released = 1').get(reviewId) as { n: number }).n;
    check('deliverable.rows', deliverableRows >= 3, `${deliverableRows} released deliverable rows`);
    check('deliverable.fullReport', existsSync(manuscriptBlobPath(reviewId, 'report/full-report.md')), 'report/full-report.md present');
  } else {
    check('gate.blockedNoDeliverable', engineError === null, 'run did not release; deliverables intentionally withheld (block or halt)');
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
    check(
      'langfuse.phase78Spans',
      traceCheck !== null && traceCheck.phase7Spans > 0 && traceCheck.phase8Spans > 0 && traceCheck.scoreMarkers > 0,
      traceCheck !== null
        ? `${traceCheck.generationCount} generations, phase7 ${traceCheck.phase7Spans}, phase8 ${traceCheck.phase8Spans}, score markers ${traceCheck.scoreMarkers}`
        : 'no trace with phase 7/8 spans and score metadata found',
    );
  }

  console.log('\n=== slice-D exercise summary ===');
  const width = summary.reduce((max, row) => Math.max(max, row.step.length), 0);
  for (const row of summary) {
    console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.step.padEnd(width)}  ${row.detail}`);
  }

  console.log('\n=== run analytics ===');
  console.log(`review id:        ${reviewId}`);
  console.log(`session id:       ${sessionId}`);
  console.log(`reused review:    ${reused !== null ? 'yes' : 'no (fresh phase 1-6)'}`);
  console.log(`critic verdict:   ${criticVerdict}`);
  console.log(`fix cycles:       ${fixCycles}`);
  console.log(`recommendation:   ${recommendation}`);
  console.log(`rubric average:   ${rubricAverage}`);
  console.log(`composite:        ${composite}`);
  console.log(`dispatches:       ${totals.count}`);
  console.log(`tokens in/out:    ${totals.tokensIn} / ${totals.tokensOut}`);
  console.log(`cached share:     ${cachedShare.toFixed(1)}%`);
  console.log(`wall clock:       ${wallSeconds}s`);
  if (traceCheck !== null) {
    console.log(`langfuse trace:   ${traceCheck.traceId ?? 'n/a'} (${traceCheck.generationCount} generations, phase7 ${traceCheck.phase7Spans}, phase8 ${traceCheck.phase8Spans})`);
  }

  sqlite.close();
  await tracing.shutdown();

  if (failures.length > 0) {
    console.log(`\n${failures.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll slice-D exercise assertions passed.');
  process.exit(0);
}

await main();
