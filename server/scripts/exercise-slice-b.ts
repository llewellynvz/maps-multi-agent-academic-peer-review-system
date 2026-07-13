import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SectionMap } from '@mara/shared';
import { blobDir, dataDir, fixturesDir, repoRoot } from '../src/paths';
import { sanitizePhase } from '../src/workflow/sanitize-phase';
import { buildIngestMastra, startIngest } from '../src/workflow/index';
import { initTracing, startRun, withPhase } from '../src/tracing';
import { buildSliceBContext, type SliceBContext } from './lib/slice-b-context';
import { buildDocx } from './lib/make-docx';

const PLOS_DOI = '10.1371/journal.pone.0275925';
const PLOS_PDF_URL = `https://journals.plos.org/plosone/article/file?id=${PLOS_DOI}&type=printable`;
const PDF_FIXTURE = resolve(fixturesDir(), 'plos-0275925.pdf');
const DOCX_FIXTURE = resolve(fixturesDir(), 'slice-b-sample.docx');
const GROBID_CONTAINER = 'mara-grobid-preflight';
const RESUME_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'exercise-slice-b-resume.ts');

const failures: string[] = [];
const summary: Array<{ step: string; detail: string; ok: boolean }> = [];

function check(step: string, ok: boolean, detail: string): void {
  summary.push({ step, detail, ok });
  if (!ok) {
    failures.push(`${step}: ${detail}`);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function insertReview(ctx: SliceBContext, reviewId: string): void {
  ctx.sqlite
    .prepare('INSERT INTO reviews (id, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(reviewId, reviewId, 'queued', nowIso(), nowIso());
}

function insertManuscriptRow(ctx: SliceBContext, reviewId: string, text: string): void {
  const bytes = Buffer.from(text, 'utf8');
  ctx.sqlite
    .prepare(
      'INSERT INTO manuscripts (id, review_id, original_filename, mime_type, blob_path, byte_size, sha256, ingested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      createHash('sha256').update(`${reviewId}-m`).digest('hex').slice(0, 32),
      reviewId,
      'fixture.txt',
      'text/plain',
      `data/blobs/${reviewId}/manuscript/original.txt`,
      bytes.byteLength,
      createHash('sha256').update(bytes).digest('hex'),
      nowIso(),
    );
}

function loadMapOrFail(step: string, reviewId: string, status: string): SectionMap | null {
  const path = resolve(blobDir(reviewId), 'parse', 'section-map.json');
  if (!existsSync(path)) {
    check(`${step}.parsed`, false, `no section map produced (workflow status ${status})`);
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as SectionMap;
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

async function ensureDocxFixture(): Promise<void> {
  if (existsSync(DOCX_FIXTURE)) {
    return;
  }
  const docx = await buildDocx({
    title: 'A Brief Mindfulness Programme and Student Wellbeing',
    sections: [
      { heading: 'Abstract', paragraphs: ['A short trial of a mindfulness programme for university students and its effect on wellbeing.'] },
      { heading: 'Introduction', paragraphs: ['Student wellbeing is under strain.', 'Brief interventions may help at scale.'] },
      { heading: 'Methods', paragraphs: ['Students were randomised to the programme or a control condition.'] },
      { heading: 'Results', paragraphs: ['The programme group reported modestly higher wellbeing.'] },
      { heading: 'Discussion', paragraphs: ['Effects were small and warrant a larger confirmatory trial.'] },
    ],
  });
  writeFileSync(DOCX_FIXTURE, docx);
}

function docker(action: 'stop' | 'start'): void {
  const result = spawnSync('docker', [action, GROBID_CONTAINER], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`docker ${action} failed: ${result.stderr ?? result.stdout ?? 'unknown'}`);
  }
}

async function waitForGrobid(ctx: SliceBContext, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ctx.grobid.isAlive()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

function spawnResume(reviewId: string, runId: string, answers: Record<string, string>): string {
  const handoffPath = resolve(dataDir(), `resume-${reviewId}.json`);
  writeFileSync(handoffPath, JSON.stringify({ reviewId, runId, answers }, null, 2));
  const child = spawnSync(process.execPath, ['--import', 'tsx', RESUME_SCRIPT, handoffPath], {
    cwd: resolve(repoRoot, 'server'),
    env: process.env,
    encoding: 'utf8',
  });
  if (child.stdout !== null && child.stdout.length > 0) {
    process.stdout.write(child.stdout);
  }
  if (child.stderr !== null && child.stderr.length > 0) {
    process.stderr.write(child.stderr);
  }
  const handoff = JSON.parse(readFileSync(handoffPath, 'utf8')) as { resumeStatus?: string };
  return handoff.resumeStatus ?? `exit_${child.status}`;
}

function checkpointStatus(ctx: SliceBContext, reviewId: string, phase: string): string | null {
  const row = ctx.sqlite
    .prepare('SELECT status FROM phase_checkpoints WHERE review_id = ? AND phase = ?')
    .get(reviewId, phase) as { status: string } | undefined;
  return row?.status ?? null;
}

async function stepGoodPath(ctx: SliceBContext): Promise<void> {
  const reviewId = `slice-b-good-${Date.now()}`;
  insertReview(ctx, reviewId);
  const mastra = buildIngestMastra({
    db: ctx.db,
    runDispatch: ctx.runDispatch,
    grobid: ctx.grobid,
    mastraDbPath: ctx.mastraDbPath,
  });

  const started = await withPhase('slice-b-good-ingest', () =>
    startIngest(mastra, {
      reviewId,
      filePath: 'data/fixtures/plos-0275925.pdf',
      originalFilename: 'plos-0275925.pdf',
      mimeType: 'application/pdf',
    }),
  );
  check('good.suspends', started.status === 'suspended', `workflow status ${started.status}`);

  const map = loadMapOrFail('good', reviewId, started.status);
  if (map === null) {
    return;
  }
  check('good.title', map.title !== null && map.title.length > 0, `title ${map.title?.slice(0, 40) ?? 'null'}`);
  check('good.abstract', map.abstract !== null && (map.abstract?.length ?? 0) > 0, `abstract ${map.abstract?.length ?? 0} chars`);
  check('good.sections', map.sections.length >= 3, `${map.sections.length} sections`);
  check('good.references', map.references.length >= 10, `${map.references.length} references`);
  check('good.parse_quality', map.parseQuality === 'good', `parse_quality ${map.parseQuality}`);

  const tei = ctx.sqlite.prepare('SELECT tei_structure_path FROM manuscripts WHERE review_id = ?').get(reviewId) as {
    tei_structure_path: string | null;
  };
  check('good.tei_recorded', tei.tei_structure_path !== null, `tei ${tei.tei_structure_path ?? 'null'}`);

  const resumeStatus = spawnResume(reviewId, started.runId, {
    preset: 'balanced',
    field: 'wellbeing science',
    journal: 'PLOS ONE',
  });
  check('good.child_resume', resumeStatus === 'success', `child resume ${resumeStatus}`);
  check('good.checkpoint', checkpointStatus(ctx, reviewId, 'phase_1') === 'completed', `phase_1 ${checkpointStatus(ctx, reviewId, 'phase_1')}`);
}

async function stepFallback(ctx: SliceBContext): Promise<void> {
  docker('stop');
  try {
    const reviewId = `slice-b-degraded-${Date.now()}`;
    insertReview(ctx, reviewId);
    const mastra = buildIngestMastra({
      db: ctx.db,
      runDispatch: ctx.runDispatch,
      grobid: ctx.grobid,
      mastraDbPath: ctx.mastraDbPath,
    });
    const started = await withPhase('slice-b-degraded-ingest', () =>
      startIngest(mastra, {
        reviewId,
        filePath: 'data/fixtures/plos-0275925.pdf',
        originalFilename: 'plos-0275925.pdf',
        mimeType: 'application/pdf',
      }),
    );
    const map = loadMapOrFail('fallback', reviewId, started.status);
    if (map !== null) {
      check('fallback.degraded', map.parseQuality === 'degraded', `parse_quality ${map.parseQuality}`);
      check('fallback.parser', map.parser === 'unpdf', `parser ${map.parser}`);
      check('fallback.suspends', started.status === 'suspended', `status ${started.status}`);

      const resumeStatus = spawnResume(reviewId, started.runId, { preset: 'fast', field: 'wellbeing science', journal: 'PLOS ONE' });
      check('fallback.completes', resumeStatus === 'success', `resume ${resumeStatus}`);
    }
  } finally {
    docker('start');
    const alive = await waitForGrobid(ctx, 150000);
    check('fallback.grobid_restarted', alive, alive ? 'isalive 200' : 'grobid did not return');
  }
}

async function stepSanitisation(ctx: SliceBContext): Promise<void> {
  const fixtures = resolve(repoRoot, 'server', 'src', 'sanitize', '__tests__', 'fixtures');
  const tier2Text = readFileSync(resolve(fixtures, 'tier2-injection.txt'), 'utf8');
  const tier3Text = readFileSync(resolve(fixtures, 'tier3-injection.txt'), 'utf8');

  const tier2Review = `slice-b-tier2-${Date.now()}`;
  insertReview(ctx, tier2Review);
  insertManuscriptRow(ctx, tier2Review, tier2Text);
  const tier2 = await withPhase('slice-b-tier2', () =>
    sanitizePhase({ db: ctx.db, reviewId: tier2Review, text: tier2Text, runDispatch: ctx.runDispatch }),
  );
  check('tier2.quarantined', tier2.status === 'quarantined', `status ${tier2.status}`);
  check('tier2.proceeds', tier2.halted === false, `halted ${tier2.halted}`);
  check('tier2.spans', tier2.quarantineLog.length > 0, `${tier2.quarantineLog.length} quarantine items`);
  const tier2Row = ctx.sqlite.prepare('SELECT quarantine_tier, sanitized_text FROM manuscripts WHERE review_id = ?').get(tier2Review) as {
    quarantine_tier: number | null;
    sanitized_text: string | null;
  };
  check('tier2.recorded', tier2Row.quarantine_tier === 2 && (tier2Row.sanitized_text ?? '').includes('[[QUARANTINED'), `tier ${tier2Row.quarantine_tier}`);

  const tier3Review = `slice-b-tier3-${Date.now()}`;
  insertReview(ctx, tier3Review);
  insertManuscriptRow(ctx, tier3Review, tier3Text);
  const tier3 = await withPhase('slice-b-tier3', () =>
    sanitizePhase({ db: ctx.db, reviewId: tier3Review, text: tier3Text, runDispatch: ctx.runDispatch }),
  );
  check('tier3.halts', tier3.halted === true, `halted ${tier3.halted}`);
  const terminal = ctx.sqlite
    .prepare("SELECT count(*) AS n FROM review_events WHERE review_id = ? AND kind = 'run_terminal'")
    .get(tier3Review) as { n: number };
  check('tier3.event_row', terminal.n >= 1, `${terminal.n} run_terminal events`);
  const tier3Status = ctx.sqlite.prepare('SELECT status FROM reviews WHERE id = ?').get(tier3Review) as { status: string };
  check('tier3.review_failed', tier3Status.status === 'failed', `review status ${tier3Status.status}`);
}

async function stepDocx(ctx: SliceBContext): Promise<void> {
  await ensureDocxFixture();
  const reviewId = `slice-b-docx-${Date.now()}`;
  insertReview(ctx, reviewId);
  const mastra = buildIngestMastra({
    db: ctx.db,
    runDispatch: ctx.runDispatch,
    grobid: ctx.grobid,
    mastraDbPath: ctx.mastraDbPath,
  });
  const started = await withPhase('slice-b-docx-ingest', () =>
    startIngest(mastra, {
      reviewId,
      filePath: 'data/fixtures/slice-b-sample.docx',
      originalFilename: 'slice-b-sample.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
  const map = loadMapOrFail('docx', reviewId, started.status);
  if (map === null) {
    return;
  }
  check('docx.parser', map.parser === 'mammoth', `parser ${map.parser}`);
  check('docx.title', map.title !== null, `title ${map.title?.slice(0, 40) ?? 'null'}`);
  check('docx.sections', map.sections.length >= 3, `${map.sections.length} sections`);

  const resumeStatus = spawnResume(reviewId, started.runId, { preset: 'balanced', field: 'wellbeing science', journal: 'PLOS ONE' });
  check('docx.completes', resumeStatus === 'success', `resume ${resumeStatus}`);
}

function printSummary(): void {
  console.log('\n=== slice-B exercise summary ===');
  const width = summary.reduce((max, row) => Math.max(max, row.step.length), 0);
  for (const row of summary) {
    console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.step.padEnd(width)}  ${row.detail}`);
  }
}

async function main(): Promise<void> {
  const tracing = initTracing({ env: process.env });
  const ctx = buildSliceBContext();
  await ensurePdfFixture();

  const grobidReady = await waitForGrobid(ctx, 30000);
  check('setup.grobid_up', grobidReady, grobidReady ? 'isalive 200' : 'grobid not reachable at start');

  const sessionId = `exercise-slice-b-${Date.now()}`;
  await startRun(sessionId, async () => {
    if (grobidReady) {
      await stepGoodPath(ctx);
    }
    await stepFallback(ctx);
    await stepSanitisation(ctx);
    await stepDocx(ctx);
  });

  try {
    await tracing.forceFlush();
    await tracing.shutdown();
  } catch (error) {
    console.log(`tracing flush warning: ${error instanceof Error ? error.message : String(error)}`);
  }

  printSummary();
  ctx.sqlite.close();

  if (failures.length > 0) {
    console.log(`\n${failures.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll slice-B exercise assertions passed.');
  process.exit(0);
}

await main();
