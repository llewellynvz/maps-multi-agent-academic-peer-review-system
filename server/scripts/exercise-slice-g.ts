import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
import { fixturesDir, repoRoot } from '../src/paths';

const execFileAsync = promisify(execFile);

const HOST_PORT = process.env.MARA_PORT ?? '3500';
const BASE = `http://127.0.0.1:${HOST_PORT}`;
const PLOS_DOI = '10.1371/journal.pone.0275925';
const PLOS_PDF_URL = `https://journals.plos.org/plosone/article/file?id=${PLOS_DOI}&type=printable`;
const PDF_FIXTURE = resolve(fixturesDir(), 'plos-0275925.pdf');
const FINDING_ID_TOKEN = /REV-[A-Z]{3,4}-\d{4}/g;
const TEST_ENV_FILE = resolve(repoRoot, 'data', '.env.slice-g');

const failures: string[] = [];
const summary: Array<{ step: string; ok: boolean; detail: string }> = [];

function check(step: string, ok: boolean, detail: string): void {
  summary.push({ step, ok, detail });
  if (!ok) {
    failures.push(`${step}: ${detail}`);
  }
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${step}  ${detail}\n`);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function ensureFixture(): Promise<void> {
  mkdirSync(fixturesDir(), { recursive: true });
  if (!existsSync(PDF_FIXTURE)) {
    const response = await fetch(PLOS_PDF_URL);
    if (!response.ok) {
      throw new Error(`PLOS fixture download failed: HTTP ${response.status}`);
    }
    writeFileSync(PDF_FIXTURE, Buffer.from(await response.arrayBuffer()));
  }
}

function writeContainerEnv(): void {
  const raw = readFileSync(resolve(repoRoot, '.env'), 'utf8');
  const lines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const key = line.split('=')[0]?.trim();
    if (key === 'LANGFUSE_HOST' || key === 'GROBID_URL' || key === 'MARA_PORT') {
      continue;
    }
    lines.push(line);
  }
  const hostLangfuse = (process.env.LANGFUSE_HOST ?? '').trim();
  if (hostLangfuse !== '') {
    lines.push(`LANGFUSE_HOST=${hostLangfuse.replace('127.0.0.1', 'host.docker.internal').replace('localhost', 'host.docker.internal')}`);
  }
  lines.push('GROBID_URL=');
  mkdirSync(resolve(repoRoot, 'data'), { recursive: true });
  writeFileSync(TEST_ENV_FILE, `${lines.join('\n')}\n`);
}

function composeEnv(): NodeJS.ProcessEnv {
  return { ...process.env, MARA_ENV_FILE: TEST_ENV_FILE, MARA_PORT: HOST_PORT };
}

function compose(args: string[], inheritStdio = true): Promise<number> {
  return new Promise((resolveExit, reject) => {
    const child = spawn('docker', ['compose', ...args], {
      cwd: repoRoot,
      env: composeEnv(),
      stdio: inheritStdio ? 'inherit' : 'ignore',
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => resolveExit(code ?? 1));
  });
}

async function containerId(): Promise<string> {
  const { stdout } = await execFileAsync('docker', ['compose', 'ps', '-q', 'mara'], {
    cwd: repoRoot,
    env: composeEnv(),
  });
  return stdout.trim();
}

interface DispatchTotals {
  count: number;
  tokensIn: number;
  tokensOut: number;
}

async function dispatchTotals(cid: string, reviewId: string): Promise<DispatchTotals> {
  const script =
    "const db=require('/app/server/node_modules/better-sqlite3')('/app/data/mara.db',{readonly:true});" +
    "const r=db.prepare(\"SELECT count(*) c, coalesce(sum(tokens_in),0) ti, coalesce(sum(tokens_out),0) too FROM dispatches WHERE review_id=? AND status='success'\").get(process.argv[1]);" +
    'process.stdout.write(JSON.stringify(r));';
  const { stdout } = await execFileAsync('docker', ['exec', cid, 'node', '-e', script, reviewId]);
  const parsed = JSON.parse(stdout.trim()) as { c: number; ti: number; too: number };
  return { count: parsed.c, tokensIn: parsed.ti, tokensOut: parsed.too };
}

async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const init: RequestInit = { method, headers: {} };
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

async function uploadManuscript(reviewId: string): Promise<Response> {
  const bytes = readFileSync(PDF_FIXTURE);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'plos-0275925.pdf');
  return fetch(`${BASE}/api/reviews/${reviewId}/manuscript`, { method: 'POST', body: form });
}

interface ReviewDetail {
  id: string;
  status: string;
  currentPhase: string | null;
  recommendation: string | null;
}

interface RunStats {
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  retryRate: number;
  timeToFirstReviewMs: number | null;
}

async function reviewStatus(reviewId: string): Promise<ReviewDetail> {
  const { json } = await api<ReviewDetail>('GET', `/api/reviews/${reviewId}`);
  return json;
}

async function runStats(reviewId: string): Promise<RunStats> {
  const { json } = await api<RunStats>('GET', `/api/reviews/${reviewId}/stats`);
  return json;
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) {
        const body = (await res.json()) as { status: string; worker: string };
        if (body.status === 'ok' && body.worker === 'up') {
          return true;
        }
      }
    } catch {
      /* not up yet */
    }
    await delay(2000);
  }
  return false;
}

async function waitForStatus(
  reviewId: string,
  predicate: (d: ReviewDetail) => boolean,
  timeoutMs: number,
): Promise<ReviewDetail> {
  const deadline = Date.now() + timeoutMs;
  let last: ReviewDetail | null = null;
  while (Date.now() < deadline) {
    last = await reviewStatus(reviewId).catch(() => last);
    if (last !== null && predicate(last)) {
      return last;
    }
    await delay(3000);
  }
  throw new Error(`review ${reviewId} did not reach the expected status in time (last ${last?.status}/${last?.currentPhase})`);
}

async function answerFast(reviewId: string): Promise<void> {
  const { json } = await api<{ questions: Array<{ id: string; default: string }> }>('GET', `/api/reviews/${reviewId}/questions`);
  const answers = json.questions.map((q) => ({
    questionId: q.id,
    value: q.id === 'preset' ? 'fast' : q.default.length > 0 ? q.default : 'wellbeing science',
  }));
  if (!answers.some((a) => a.questionId === 'preset')) {
    answers.push({ questionId: 'preset', value: 'fast' });
  }
  await api('POST', `/api/reviews/${reviewId}/answers`, { answers });
}

async function startReview(title: string): Promise<string> {
  const created = await api<{ id: string }>('POST', '/api/reviews', { title });
  const reviewId = created.json.id;
  const upload = await uploadManuscript(reviewId);
  check(`${title}.upload`, upload.status === 201, `upload status ${upload.status}`);
  await waitForStatus(reviewId, (d) => d.status === 'awaiting_input', 240000);
  await answerFast(reviewId);
  return reviewId;
}

async function assertDeliverables(reviewId: string): Promise<void> {
  const deliverables = await api<{ deliverables: Array<{ kind: string; format: string; checksum: string; released: boolean }> }>(
    'GET',
    `/api/reviews/${reviewId}/deliverables`,
  );
  const releasedDocx = deliverables.json.deliverables.filter((d) => d.released && d.format === 'docx');
  let ok = releasedDocx.length >= 2;
  for (const kind of ['peer_review_report', 'reviewer_private_notes']) {
    const res = await fetch(`${BASE}/api/reviews/${reviewId}/deliverables/${kind}?format=docx`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const digest = sha256(bytes);
    const listed = deliverables.json.deliverables.find((d) => d.kind === kind && d.format === 'docx');
    if (res.status !== 200 || listed === undefined || digest !== listed.checksum) {
      ok = false;
    }
  }
  check('deliverable.checksums', ok, `${releasedDocx.length} released docx, downloaded checksums match the deliverables listing`);

  const reportRes = await fetch(`${BASE}/api/reviews/${reviewId}/deliverables/peer_review_report?format=md`);
  const reportText = await reportRes.text();
  const idsInReport = new Set<string>();
  let match = FINDING_ID_TOKEN.exec(reportText);
  while (match !== null) {
    idsInReport.add(match[0]);
    match = FINDING_ID_TOKEN.exec(reportText);
  }
  FINDING_ID_TOKEN.lastIndex = 0;
  check('report.grounded', idsInReport.size > 0, `${idsInReport.size} finding ids cited in the released report`);
}

interface TraceCheck {
  traceCount: number;
  generationCount: number;
  phaseSpanCount: number;
}

function langfuseHost(): string {
  return (process.env.LANGFUSE_HOST ?? '')
    .replace(/\/+$/, '')
    .replace('host.docker.internal', '127.0.0.1')
    .replace('localhost', '127.0.0.1');
}

function langfuseAuthHeader(): string {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY ?? '';
  const secretKey = process.env.LANGFUSE_SECRET_KEY ?? '';
  return `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`;
}

async function pollLangfuse(session: string): Promise<TraceCheck | null> {
  const host = langfuseHost();
  if (host === '') {
    return null;
  }
  const auth = langfuseAuthHeader();
  for (let attempt = 0; attempt < 20; attempt += 1) {
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
          const detailResponse = await fetch(`${host}/api/public/traces/${trace.id}`, { headers: { Authorization: auth } });
          if (detailResponse.ok) {
            const detail = (await detailResponse.json()) as { observations?: Array<{ type?: string; name?: string }> };
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
      /* transient */
    }
    await delay(3000);
  }
  return null;
}

async function main(): Promise<void> {
  loadEnv();
  await ensureFixture();
  writeContainerEnv();

  process.stdout.write('Bringing the container up on host port ' + HOST_PORT + ' ...\n');
  const upCode = await compose(['up', '-d', '--wait', '--wait-timeout', '240']);
  check('container.up', upCode === 0, `docker compose up exit ${upCode}`);
  const healthy = await waitForHealth(240000);
  check('container.healthy', healthy, `app + worker healthy on ${BASE}`);
  const cid = await containerId();

  const runOneWall = Date.now();
  const reviewOne = await startReview('PLOS containerised review');
  const doneOne = await waitForStatus(reviewOne, (d) => ['completed', 'failed'].includes(d.status), 900000);
  check('reviewOne.completed', doneOne.status === 'completed', `first containerised review ${doneOne.status}`);
  const oneWallSeconds = ((Date.now() - runOneWall) / 1000).toFixed(1);

  await assertDeliverables(reviewOne);

  const trace = await pollLangfuse(reviewOne);
  check(
    'langfuse.trace',
    trace !== null,
    trace !== null
      ? `session ${reviewOne}: ${trace.generationCount} generations, ${trace.phaseSpanCount} phase spans across ${trace.traceCount} trace(s)`
      : 'no trace with generations and phase spans found for the run session',
  );

  const statsOne = await runStats(reviewOne);
  const totalsOne = await dispatchTotals(cid, reviewOne).catch(() => ({ count: 0, tokensIn: 0, tokensOut: 0 }));

  process.stdout.write('\nStarting the second review for the restart-resilience proof ...\n');
  const runTwoWall = Date.now();
  const reviewTwo = await startReview('PLOS restart-resilience review');
  await waitForStatus(reviewTwo, (d) => d.status === 'running', 120000);
  let started = false;
  const midDeadline = Date.now() + 300000;
  while (Date.now() < midDeadline) {
    const s = await runStats(reviewTwo).catch(() => null);
    if (s !== null && s.tokensIn > 0) {
      started = true;
      break;
    }
    const detail = await reviewStatus(reviewTwo).catch(() => null);
    if (detail !== null && ['completed', 'failed'].includes(detail.status)) {
      break;
    }
    await delay(3000);
  }
  check('reviewTwo.midRun', started, started ? 'second review reached mid-run work before restart' : 'second review did not reach mid-run work');

  process.stdout.write('Restarting the container mid-run ...\n');
  await execFileAsync('docker', ['restart', cid]);
  const healthyAgain = await waitForHealth(240000);
  check('container.restarted', healthyAgain, 'container healthy again after restart');

  const doneTwo = await waitForStatus(reviewTwo, (d) => ['completed', 'failed'].includes(d.status), 900000);
  check('reviewTwo.recovered', doneTwo.status === 'completed', `second review ${doneTwo.status} after mid-run container restart`);
  const twoWallSeconds = ((Date.now() - runTwoWall) / 1000).toFixed(1);
  const totalsTwo = await dispatchTotals(cid, reviewTwo).catch(() => ({ count: 0, tokensIn: 0, tokensOut: 0 }));

  let recoveryLogged = false;
  try {
    const { stdout } = await execFileAsync('docker', ['logs', '--tail', '400', cid], { maxBuffer: 8 * 1024 * 1024 });
    recoveryLogged = /restart|recover|resum|active workflow|lease/i.test(stdout);
  } catch {
    /* logs optional */
  }
  check('reviewTwo.recoveryTrace', recoveryLogged, recoveryLogged ? 'worker logged recovery activity after restart' : 'no recovery log line observed (non-blocking)');

  process.stdout.write('\n=== slice-G container analytics ===\n');
  process.stdout.write(`review one:        ${reviewOne} (${doneOne.recommendation ?? 'n/a'})\n`);
  process.stdout.write(`  dispatches:      ${totalsOne.count}\n`);
  process.stdout.write(`  tokens in/out:   ${totalsOne.tokensIn} / ${totalsOne.tokensOut}\n`);
  process.stdout.write(`  cached tokens:   ${statsOne.tokensCached}\n`);
  process.stdout.write(`  cost usd:        ${statsOne.costUsd.toFixed(4)}\n`);
  process.stdout.write(`  wall clock:      ${oneWallSeconds}s\n`);
  process.stdout.write(`review two:        ${reviewTwo} (restart-resilience, ${doneTwo.recommendation ?? 'n/a'})\n`);
  process.stdout.write(`  dispatches:      ${totalsTwo.count}\n`);
  process.stdout.write(`  tokens in/out:   ${totalsTwo.tokensIn} / ${totalsTwo.tokensOut}\n`);
  process.stdout.write(`  wall clock:      ${twoWallSeconds}s (includes the restart)\n`);
}

async function teardown(): Promise<void> {
  process.stdout.write('\nTearing the container down (keeping the image) ...\n');
  await compose(['down']).catch(() => undefined);
}

main()
  .then(async () => {
    await teardown();
    process.stdout.write('\n=== slice-G exercise summary ===\n');
    const width = summary.reduce((max, row) => Math.max(max, row.step.length), 0);
    for (const row of summary) {
      process.stdout.write(`${row.ok ? 'PASS' : 'FAIL'}  ${row.step.padEnd(width)}  ${row.detail}\n`);
    }
    if (failures.length > 0) {
      process.stdout.write(`\n${failures.length} assertion(s) failed.\n`);
      process.exit(1);
    }
    process.stdout.write('\nAll slice-G exercise assertions passed.\n');
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    process.stderr.write(`\nslice-G exercise error: ${error instanceof Error ? error.stack : String(error)}\n`);
    await teardown();
    process.exit(1);
  });
