import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { createDb, type SqliteConnection } from '../src/db/client';
import { dataDir, fixturesDir, maraDbPath, repoRoot } from '../src/paths';

const PORT = process.env.MARA_PORT ?? '3100';
const BASE = `http://127.0.0.1:${PORT}`;
const PLOS_DOI = '10.1371/journal.pone.0275925';
const PLOS_PDF_URL = `https://journals.plos.org/plosone/article/file?id=${PLOS_DOI}&type=printable`;
const PDF_FIXTURE = resolve(fixturesDir(), 'plos-0275925.pdf');
const TINY_FIXTURE = resolve(repoRoot, 'server', 'src', 'ingest', '__tests__', 'fixtures', 'sample.docx');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FINDING_ID_TOKEN = /REV-[A-Z]{3,4}-\d{4}/g;

const failures: string[] = [];
const summary: Array<{ step: string; ok: boolean; detail: string }> = [];
const children: ChildProcess[] = [];

function check(step: string, ok: boolean, detail: string): void {
  summary.push({ step, ok, detail });
  if (!ok) {
    failures.push(`${step}: ${detail}`);
  }
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${step}  ${detail}\n`);
}

function loadEnv(): void {
  try {
    process.loadEnvFile(resolve(repoRoot, '.env'));
  } catch {
    /* optional */
  }
  const cert = process.env.AZURE_CLIENT_CERT_PEM_PATH;
  if (cert !== undefined && cert !== '' && !isAbsolute(cert)) {
    process.env.AZURE_CLIENT_CERT_PEM_PATH = resolve(repoRoot, cert);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureFixtures(): Promise<void> {
  mkdirSync(fixturesDir(), { recursive: true });
  if (!existsSync(PDF_FIXTURE)) {
    const response = await fetch(PLOS_PDF_URL);
    if (!response.ok) {
      throw new Error(`PLOS fixture download failed: HTTP ${response.status}`);
    }
    writeFileSync(PDF_FIXTURE, Buffer.from(await response.arrayBuffer()));
  }
  if (!existsSync(TINY_FIXTURE)) {
    throw new Error(`Missing the small DOCX fixture at ${TINY_FIXTURE}`);
  }
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function run(args: string[]): Promise<number> {
  return new Promise((resolveExit, reject) => {
    const child = spawn(npmCommand(), args, { cwd: repoRoot, env: process.env, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) => resolveExit(code ?? 1));
  });
}

function spawnService(name: string, args: string[]): ChildProcess {
  const child = spawn(npmCommand(), args, {
    cwd: repoRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[${name}] ${chunk.toString()}`));
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[${name}] ${chunk.toString()}`));
  children.push(child);
  return child;
}

interface Health {
  status: string;
  worker: string;
  db: string;
}

async function waitForApp(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) {
        const body = (await res.json()) as Health;
        if (body.status === 'ok') {
          return;
        }
      }
    } catch {
      /* not up yet */
    }
    await delay(1000);
  }
  throw new Error('app did not become healthy in time');
}

async function waitForWorker(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/health`);
    const body = (await res.json()) as Health;
    if (body.worker === 'up') {
      return;
    }
    await delay(1000);
  }
  throw new Error('worker heartbeat did not appear in time');
}

async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: T }> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json: T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    json = text as unknown as T;
  }
  return { status: res.status, json };
}

async function uploadManuscript(reviewId: string, filePath: string, filename: string, mime: string): Promise<Response> {
  const bytes = readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), filename);
  return fetch(`${BASE}/api/reviews/${reviewId}/manuscript`, { method: 'POST', body: form });
}

interface ReviewDetail {
  id: string;
  status: string;
  currentPhase: string | null;
  recommendation: string | null;
}

async function reviewStatus(reviewId: string): Promise<ReviewDetail> {
  const { json } = await api<ReviewDetail>('GET', `/api/reviews/${reviewId}`);
  return json;
}

async function waitForStatus(reviewId: string, predicate: (d: ReviewDetail) => boolean, timeoutMs: number): Promise<ReviewDetail> {
  const deadline = Date.now() + timeoutMs;
  let last: ReviewDetail | null = null;
  while (Date.now() < deadline) {
    last = await reviewStatus(reviewId);
    if (predicate(last)) {
      return last;
    }
    await delay(2000);
  }
  throw new Error(`review ${reviewId} did not reach the expected status in time (last ${last?.status}/${last?.currentPhase})`);
}

interface SseEvent {
  id?: number;
  event: string;
  data: unknown;
}

async function consumeSse(
  reviewId: string,
  options: { lastEventId?: number; stopAfterEvents?: string[]; dropAfterIds?: number; maxMs: number },
): Promise<{ events: SseEvent[]; lastId: number }> {
  const controller = new AbortController();
  const headers: Record<string, string> = {};
  if (options.lastEventId !== undefined) {
    headers['Last-Event-ID'] = String(options.lastEventId);
  }
  const res = await fetch(`${BASE}/api/reviews/${reviewId}/events`, { headers, signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  let lastId = options.lastEventId ?? 0;
  let buffer = '';
  const deadline = Date.now() + options.maxMs;
  let idsWithLine = 0;

  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        if (frame.startsWith(':') || frame.trim().length === 0) {
          continue;
        }
        let id: number | undefined;
        let event = 'message';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('id:')) {
            id = Number.parseInt(line.slice(3).trim(), 10);
          } else if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            data += line.slice(5).trim();
          }
        }
        const parsed: SseEvent = { event, data: data.length > 0 ? JSON.parse(data) : null };
        if (id !== undefined) {
          parsed.id = id;
          lastId = id;
          idsWithLine += 1;
        }
        events.push(parsed);
        if (options.stopAfterEvents !== undefined && options.stopAfterEvents.includes(event)) {
          return { events, lastId };
        }
        if (options.dropAfterIds !== undefined && idsWithLine >= options.dropAfterIds) {
          return { events, lastId };
        }
      }
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
  return { events, lastId };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function streamedSeqs(sqlite: SqliteConnection, reviewId: string): number[] {
  const rows = sqlite
    .prepare(
      "SELECT seq FROM review_events WHERE review_id = ? AND kind IN ('phase_transition','gate_verdict','finding_recorded','run_terminal') ORDER BY seq",
    )
    .all(reviewId) as Array<{ seq: number }>;
  return rows.map((r) => r.seq);
}

async function answerWithPreset(reviewId: string, preset: string): Promise<void> {
  const { json } = await api<{ questions: Array<{ id: string; default: string }> }>('GET', `/api/reviews/${reviewId}/questions`);
  const answers = json.questions.map((q) => ({
    questionId: q.id,
    value: q.id === 'preset' ? preset : q.default.length > 0 ? q.default : 'wellbeing science',
  }));
  if (!answers.some((a) => a.questionId === 'preset')) {
    answers.push({ questionId: 'preset', value: preset });
  }
  await api('POST', `/api/reviews/${reviewId}/answers`, { answers });
}

function readComposite(reviewId: string): string {
  try {
    const path = resolve(dataDir(), 'blobs', reviewId, 'engine', 'p8-quality-metrics.json');
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { composite?: number };
      return typeof parsed.composite === 'number' ? parsed.composite.toFixed(3) : 'n/a';
    }
  } catch {
    /* optional */
  }
  return 'n/a';
}

async function main(): Promise<void> {
  loadEnv();
  mkdirSync(dataDir(), { recursive: true });
  await ensureFixtures();

  if (!existsSync(resolve(repoRoot, 'app', '.next', 'BUILD_ID'))) {
    process.stdout.write('Building the app (next build) ...\n');
    const code = await run(['--filter', 'app', 'build']);
    if (code !== 0) {
      throw new Error(`next build failed with code ${code}`);
    }
  }

  spawnService('app', ['--filter', 'app', 'exec', 'next', 'start', '-p', PORT, '-H', '127.0.0.1']);
  spawnService('worker', ['--filter', 'server', 'worker']);

  await waitForApp(90000);
  check('boot.app', true, `app healthy on ${BASE}`);
  await waitForWorker(30000);
  check('boot.worker', true, 'worker heartbeat up');

  const { db, sqlite } = createDb(maraDbPath());
  const startWall = Date.now();

  const created = await api<{ id: string }>('POST', '/api/reviews', { title: 'PLOS wellbeing study' });
  const reviewId = created.json.id;
  check('review.create', created.status === 201 && typeof reviewId === 'string', `created ${reviewId}`);

  const upload = await uploadManuscript(reviewId, PDF_FIXTURE, 'plos-0275925.pdf', 'application/pdf');
  check('review.upload', upload.status === 201, `upload status ${upload.status}`);

  await waitForStatus(reviewId, (d) => d.status === 'awaiting_input', 180000);
  const questions = await api<{ questions: Array<{ id: string }> }>('GET', `/api/reviews/${reviewId}/questions`);
  check('review.questions', questions.status === 200 && questions.json.questions.length > 0, `${questions.json.questions?.length ?? 0} questions`);

  await answerWithPreset(reviewId, 'fast');
  await waitForStatus(reviewId, (d) => d.status === 'running', 60000);
  const optionsRow = sqlite.prepare('SELECT options_json FROM reviews WHERE id = ?').get(reviewId) as { options_json: string };
  const options = JSON.parse(optionsRow.options_json) as { preset?: string };
  check('review.presetOverride', options.preset === 'fast', `options_json preset ${options.preset ?? 'unset'}`);

  const firstLeg = await consumeSse(reviewId, { dropAfterIds: 2, maxMs: 180000 });
  check('sse.firstLeg', firstLeg.events.some((e) => e.id !== undefined), `received ${firstLeg.events.length} frames, lastId ${firstLeg.lastId}`);

  const tinyCreated = await api<{ id: string }>('POST', '/api/reviews', { title: 'Tiny queued study' });
  const tinyId = tinyCreated.json.id;
  await uploadManuscript(tinyId, TINY_FIXTURE, 'sample.docx', DOCX_MIME);
  await delay(3000);
  const tinyWhileBusy = await reviewStatus(tinyId);
  check('queue.secondQueued', tinyWhileBusy.status === 'queued', `second review status ${tinyWhileBusy.status} while first runs`);

  const secondLeg = await consumeSse(reviewId, {
    lastEventId: firstLeg.lastId,
    stopAfterEvents: ['run_complete', 'run_failed'],
    maxMs: 600000,
  });
  const receivedIds = new Set<number>([
    ...firstLeg.events.filter((e) => e.id !== undefined).map((e) => e.id as number),
    ...secondLeg.events.filter((e) => e.id !== undefined).map((e) => e.id as number),
  ]);
  const allSeqs = streamedSeqs(sqlite, reviewId);
  const missing = allSeqs.filter((seq) => seq > firstLeg.lastId && !receivedIds.has(seq));
  check('sse.reconnectNoGap', secondLeg.lastId > firstLeg.lastId && missing.length === 0, `resumed after ${firstLeg.lastId}, missing ${missing.length} of ${allSeqs.length} streamed events`);
  check('sse.runComplete', secondLeg.events.some((e) => e.event === 'run_complete'), 'run_complete received over SSE');

  const firstDone = await waitForStatus(reviewId, (d) => ['completed', 'failed'].includes(d.status), 60000);
  check('review.completed', firstDone.status === 'completed', `first review ${firstDone.status}`);

  const tinyStarted = await waitForStatus(tinyId, (d) => d.status !== 'queued' && d.status !== 'created', 120000);
  check('queue.secondStartsAfter', ['sanitizing', 'awaiting_input', 'running'].includes(tinyStarted.status), `second left the queue as ${tinyStarted.status} after the first completed`);
  if (tinyStarted.status === 'awaiting_input') {
    await answerWithPreset(tinyId, 'fast');
  }

  const deliverables = await api<{ deliverables: Array<{ kind: string; format: string; checksum: string; released: boolean }> }>(
    'GET',
    `/api/reviews/${reviewId}/deliverables`,
  );
  const releasedDocx = deliverables.json.deliverables.filter((d) => d.released && d.format === 'docx');
  let checksumOk = releasedDocx.length >= 2;
  for (const kind of ['peer_review_report', 'reviewer_private_notes']) {
    const res = await fetch(`${BASE}/api/reviews/${reviewId}/deliverables/${kind}?format=docx`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const digest = sha256(bytes);
    const row = sqlite.prepare('SELECT checksum FROM deliverables WHERE review_id = ? AND kind = ? AND format = ?').get(reviewId, kind, 'docx') as { checksum: string } | undefined;
    const listed = deliverables.json.deliverables.find((d) => d.kind === kind && d.format === 'docx');
    if (res.status !== 200 || digest !== row?.checksum || digest !== listed?.checksum) {
      checksumOk = false;
    }
  }
  check('deliverable.checksums', checksumOk, `${releasedDocx.length} released docx, checksums match db rows and the list`);

  const reportRes = await fetch(`${BASE}/api/reviews/${reviewId}/deliverables/peer_review_report?format=md`);
  const reportText = await reportRes.text();
  const editorOnly = new Set(
    (sqlite.prepare("SELECT id FROM v_current_findings WHERE review_id = ? AND scope = 'editor_only'").all(reviewId) as Array<{ id: string }>).map((r) => r.id),
  );
  const idsInReport = new Set<string>();
  let match = FINDING_ID_TOKEN.exec(reportText);
  while (match !== null) {
    idsInReport.add(match[0]);
    match = FINDING_ID_TOKEN.exec(reportText);
  }
  FINDING_ID_TOKEN.lastIndex = 0;
  const leaked = [...idsInReport].filter((id) => editorOnly.has(id));
  check('leak.authorFacing', leaked.length === 0, `${leaked.length} editor-only ids in the author-facing report (of ${editorOnly.size} editor-only findings)`);

  const headlineLeak = firstLeg.events
    .concat(secondLeg.events)
    .filter((e) => e.event === 'finding_headline')
    .filter((e) => {
      const data = e.data as { scope: string; headline: string };
      return data.scope === 'editor_only' && data.headline !== 'Confidential signal recorded';
    });
  check('leak.sseMasking', headlineLeak.length === 0, `${headlineLeak.length} unmasked editor-only headlines in the stream`);

  await api('PUT', '/api/settings', { passphrase: 'slice-e-passphrase' });
  const gated = await fetch(`${BASE}/api/reviews`);
  check('passphrase.gated', gated.status === 401, `unauthenticated list returned ${gated.status}`);
  const session = await api<{ token: string }>('POST', '/api/session', { passphrase: 'slice-e-passphrase' });
  const authed = await fetch(`${BASE}/api/reviews`, { headers: { authorization: `Bearer ${session.json.token}` } });
  check('passphrase.session', session.status === 200 && authed.status === 200, `session ${session.status}, authed list ${authed.status}`);
  await api('PUT', '/api/settings', { passphrase: null }, { authorization: `Bearer ${session.json.token}` });
  const reopened = await fetch(`${BASE}/api/reviews`);
  check('passphrase.cleared', reopened.status === 200, `list after clear ${reopened.status}`);

  const wallSeconds = ((Date.now() - startWall) / 1000).toFixed(1);
  const totals = sqlite
    .prepare(
      "SELECT count(*) AS count, coalesce(sum(tokens_in),0) AS tokensIn, coalesce(sum(tokens_out),0) AS tokensOut, coalesce(sum(tokens_cached),0) AS tokensCached FROM dispatches WHERE review_id = ? AND status = 'success'",
    )
    .get(reviewId) as { count: number; tokensIn: number; tokensOut: number; tokensCached: number };
  const cachedShare = totals.tokensIn > 0 ? (totals.tokensCached / totals.tokensIn) * 100 : 0;
  const gate = sqlite.prepare("SELECT gate_verdict FROM phase_checkpoints WHERE review_id = ? AND phase = 'engine_phase_7'").get(reviewId) as { gate_verdict: string | null } | undefined;
  const composite = readComposite(reviewId);

  process.stdout.write('\n=== slice-E run analytics ===\n');
  process.stdout.write(`review id:      ${reviewId}\n`);
  process.stdout.write(`second review:  ${tinyId}\n`);
  process.stdout.write(`verdict:        ${gate?.gate_verdict ?? 'n/a'}\n`);
  process.stdout.write(`recommendation: ${firstDone.recommendation ?? 'n/a'}\n`);
  process.stdout.write(`composite:      ${composite}\n`);
  process.stdout.write(`dispatches:     ${totals.count}\n`);
  process.stdout.write(`tokens in/out:  ${totals.tokensIn} / ${totals.tokensOut}\n`);
  process.stdout.write(`cached share:   ${cachedShare.toFixed(1)}%\n`);
  process.stdout.write(`wall clock:     ${wallSeconds}s\n`);

  sqlite.close();
  void db;
}

function shutdownChildren(): void {
  for (const child of children) {
    if (child.pid !== undefined && !child.killed) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: true });
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        /* best effort */
      }
    }
  }
}

main()
  .then(() => {
    process.stdout.write('\n=== slice-E exercise summary ===\n');
    const width = summary.reduce((max, row) => Math.max(max, row.step.length), 0);
    for (const row of summary) {
      process.stdout.write(`${row.ok ? 'PASS' : 'FAIL'}  ${row.step.padEnd(width)}  ${row.detail}\n`);
    }
    shutdownChildren();
    if (failures.length > 0) {
      process.stdout.write(`\n${failures.length} assertion(s) failed.\n`);
      process.exit(1);
    }
    process.stdout.write('\nAll slice-E exercise assertions passed.\n');
    process.exit(0);
  })
  .catch((error: unknown) => {
    process.stderr.write(`\nslice-E exercise error: ${error instanceof Error ? error.stack : String(error)}\n`);
    shutdownChildren();
    process.exit(1);
  });
