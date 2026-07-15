import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { defaultFetch } from '../src/citations';
import { createDb, type MaraDatabase, type SqliteConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { referencesForVerification } from '../src/engine/context';
import { dataDir, maraDbPath, repoRoot } from '../src/paths';
import {
  buildNgramIndex,
  canonicalQuery,
  createEgressController,
  type EgressLogEntry,
  isPublishedReference,
  openKey,
  type SealedKey,
  signQuery,
} from '../src/security';
import { insertEvent } from '../src/workflow/repo';
import type { SectionMap } from '@mara/shared';

const PORT = process.env.MARA_PORT ?? '3100';
const BASE = `http://127.0.0.1:${PORT}`;
const SELIGMAN_DOI = '10.1037/0003-066X.55.1.5';
const FAKE_OPENAI_KEY = `sk-fake-slice-f-${randomBytes(6).toString('hex')}-DO-NOT-USE`;
const CROSSREF = 'https://api.crossref.org';

const MANUSCRIPT_BODY =
  'Participants in the strengths based intervention reported higher flourishing scores at the twelve week follow up compared with the waitlist control group across two organisational sites.';

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
  if (process.env.MARA_MASTER_KEY === undefined || process.env.MARA_MASTER_KEY === '') {
    process.env.MARA_MASTER_KEY = randomBytes(32).toString('hex');
    process.stdout.write('[slice-f] generated an ephemeral master key for this run (value not printed)\n');
  }
}

function sweepPort(port: string): void {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf8' });
      const pids = new Set<string>();
      for (const line of out.split('\n')) {
        if (line.includes(`:${port} `) && line.toUpperCase().includes('LISTENING')) {
          const pid = line.trim().split(/\s+/).pop() ?? '';
          if (/^\d+$/.test(pid)) {
            pids.add(pid);
          }
        }
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        } catch {
          /* already gone */
        }
      }
    } else {
      execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: 'ignore', shell: '/bin/sh' });
    }
  } catch {
    /* nothing listening */
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function run(args: string[]): Promise<number> {
  return new Promise((resolveExit, reject) => {
    const child = spawn(npmCommand(), args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
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

async function waitForApp(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) {
        const body = (await res.json()) as { status: string };
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

interface ProviderKeyRow {
  id: string;
  provider: string;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  wrapped_dek: Buffer;
  dek_iv: Buffer;
  dek_auth_tag: Buffer;
}

interface WebQueryRow {
  egress_target: string | null;
  egress_query: string | null;
  payload_json: string;
}

function webQueryEvents(sqlite: SqliteConnection, reviewId: string): WebQueryRow[] {
  return sqlite
    .prepare("SELECT egress_target, egress_query, payload_json FROM review_events WHERE review_id = ? AND kind = 'web_query' ORDER BY seq")
    .all(reviewId) as WebQueryRow[];
}

async function exerciseKeyVault(sqlite: SqliteConnection): Promise<void> {
  const added = await api<{ id: string; maskedKey: string; provider: string }>('POST', '/api/keys', {
    provider: 'openai',
    apiKey: FAKE_OPENAI_KEY,
    persist: 'disk',
  });
  check('vault.store', added.status === 201 && typeof added.json.id === 'string', `POST /api/keys status ${added.status}`);

  const row = sqlite
    .prepare('SELECT * FROM provider_keys WHERE id = ?')
    .get(added.json.id) as ProviderKeyRow | undefined;
  const cipherHasPlaintext =
    row !== undefined &&
    (Buffer.from(row.ciphertext).toString('utf8').includes(FAKE_OPENAI_KEY) ||
      Buffer.from(row.ciphertext).toString('latin1').includes(FAKE_OPENAI_KEY));
  check('vault.ciphertextAtRest', row !== undefined && !cipherHasPlaintext, 'stored ciphertext differs from plaintext and hides it');

  let decryptOk = false;
  if (row !== undefined) {
    const sealed: SealedKey = {
      ciphertext: Buffer.from(row.ciphertext),
      iv: Buffer.from(row.iv),
      authTag: Buffer.from(row.auth_tag),
      wrappedDek: Buffer.from(row.wrapped_dek),
      dekIv: Buffer.from(row.dek_iv),
      dekAuthTag: Buffer.from(row.dek_auth_tag),
    };
    decryptOk = openKey(sealed) === FAKE_OPENAI_KEY;
  }
  check('vault.decryptInWorker', decryptOk, 'worker-context decrypt path returns the original key');

  const listed = await api<{ keys: Array<{ id: string; maskedKey: string }> }>('GET', '/api/keys');
  const maskLeaks = listed.json.keys.some((k) => k.maskedKey.includes(FAKE_OPENAI_KEY.slice(4)));
  check('vault.maskedInApi', listed.status === 200 && !maskLeaks, 'GET /api/keys never returns the plaintext key');

  const deleted = await api<{ deleted: boolean }>('DELETE', `/api/keys/${added.json.id}`);
  const gone = sqlite.prepare('SELECT id FROM provider_keys WHERE id = ?').get(added.json.id) === undefined;
  check('vault.delete', deleted.status === 200 && gone, `DELETE removed the row (status ${deleted.status})`);
}

async function exerciseEgress(db: MaraDatabase, sqlite: SqliteConnection): Promise<void> {
  const created = await api<{ id: string }>('POST', '/api/reviews', { title: 'slice-f egress audit' });
  const reviewId = created.json.id;
  check('egress.review', created.status === 201 && typeof reviewId === 'string', `review ${reviewId} created for the audit trail`);

  const signingKey = randomBytes(32);
  const logs: EgressLogEntry[] = [];
  const controller = createEgressController(defaultFetch);
  controller.begin({
    reviewId,
    signingKey,
    corpus: buildNgramIndex(MANUSCRIPT_BODY, 8),
    log: (entry) => {
      logs.push(entry);
      insertEvent(db, {
        reviewId,
        kind: 'web_query',
        phase: 'phase_2',
        egressTarget: entry.target,
        egressQuery: entry.query,
        payload: { blocked: entry.blocked, reason: entry.reason, signature: entry.signature },
      });
    },
  });

  let blockedHost = false;
  try {
    await controller.fetch('https://evil.example.com/exfiltrate');
  } catch {
    blockedHost = true;
  }
  check('egress.hostBlocked', blockedHost, 'a non-allowlisted host is refused before any network call');

  const leakingQuery = `${CROSSREF}/works?query.bibliographic=${encodeURIComponent(
    'the strengths based intervention reported higher flourishing scores at the twelve week follow up',
  )}`;
  let blockedNgram = false;
  try {
    await controller.fetch(leakingQuery);
  } catch {
    blockedNgram = true;
  }
  check('egress.ngramBlocked', blockedNgram, 'a query carrying manuscript body text is refused by the n-gram guard');

  const doiUrl = `${CROSSREF}/works/${encodeURIComponent(SELIGMAN_DOI)}${
    process.env.MARA_CONTACT_EMAIL ? `?mailto=${encodeURIComponent(process.env.MARA_CONTACT_EMAIL)}` : ''
  }`;
  let doiOk = false;
  try {
    const response = await controller.fetch(doiUrl);
    doiOk = response.ok;
  } catch (error) {
    doiOk = false;
    process.stdout.write(`[slice-f] Seligman DOI lookup error: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  check('egress.legitPasses', doiOk, 'the known-good Seligman DOI query passes the guard and reaches Crossref');

  controller.end();

  const events = webQueryEvents(sqlite, reviewId);
  const hostEvent = events.find((e) => (JSON.parse(e.payload_json) as { reason?: string }).reason?.startsWith('host_not_allowlisted'));
  check('egress.hostLogged', hostEvent !== undefined && hostEvent.egress_target === null, 'the blocked-host attempt is logged with a null target');

  const ngramEvent = events.find((e) => (JSON.parse(e.payload_json) as { reason?: string }).reason === 'ngram');
  check('egress.ngramLogged', ngramEvent !== undefined && ngramEvent.egress_target === 'crossref', 'the n-gram block is logged against crossref');

  const allowed = events.find((e) => {
    const payload = JSON.parse(e.payload_json) as { blocked?: boolean; signature?: string | null };
    return payload.blocked === false && e.egress_target === 'crossref';
  });
  let signatureValid = false;
  if (allowed !== undefined && allowed.egress_query !== null) {
    const payload = JSON.parse(allowed.payload_json) as { signature?: string | null };
    signatureValid = payload.signature === signQuery(allowed.egress_query, signingKey);
  }
  check(
    'egress.signedLogged',
    allowed !== undefined && signatureValid && allowed.egress_query === canonicalQuery(doiUrl),
    'the allowed call is logged with egress_target, egress_query, and a valid signature',
  );
}

function exerciseInPrepFilter(): void {
  const sectionMap: SectionMap = {
    title: 'Confidential manuscript',
    abstract: null,
    sections: [],
    references: [
      {
        index: 1,
        raw: 'Van Zyl, L. (in preparation). Unpublished findings on the strengths intervention effect.',
        title: 'Unpublished findings on the strengths intervention effect',
        doi: null,
        year: null,
        venue: null,
        authors: ['Van Zyl'],
      },
      {
        index: 2,
        raw: 'Seligman, M., & Csikszentmihalyi, M. (2000). Positive psychology: An introduction.',
        title: 'Positive psychology an introduction',
        doi: SELIGMAN_DOI,
        year: 2000,
        venue: 'American Psychologist',
        authors: ['Seligman', 'Csikszentmihalyi'],
      },
      {
        index: 3,
        raw: 'Van Zyl, L. (2025). Strengths coaching and flourishing at work.',
        title: 'Strengths coaching and flourishing at work',
        doi: null,
        year: 2025,
        venue: null,
        authors: ['Van Zyl'],
      },
    ],
    fullText: '',
    parser: 'grobid',
    parseQuality: 'good',
  };
  const eligible = referencesForVerification(sectionMap, 'standard').references;
  const inPrepExcluded = !eligible.some((r) => r.index === 1);
  const publishedKept = eligible.some((r) => r.index === 2);
  const noIdentifierExcluded = !eligible.some((r) => r.index === 3);
  check('inPrep.predicate', !isPublishedReference(sectionMap.references[0]!) && isPublishedReference(sectionMap.references[1]!), 'the in-prep predicate excludes the unpublished reference');
  check('inPrep.filteredBeforeClient', inPrepExcluded && publishedKept, 'the in-prep reference is filtered before the citation client sees it');
  check('inPrep.noIdentifierExcluded', noIdentifierExcluded, 'a self-citation without a stable identifier never reaches egress');
}

async function main(): Promise<void> {
  loadEnv();
  mkdirSync(dataDir(), { recursive: true });

  const { db, sqlite } = createDb(maraDbPath());
  runMigrations(db);

  sweepPort(PORT);
  if (!existsSync(resolve(repoRoot, 'app', '.next', 'BUILD_ID'))) {
    process.stdout.write('Building the app (next build) ...\n');
    const code = await run(['--filter', 'app', 'build']);
    if (code !== 0) {
      throw new Error(`next build failed with code ${code}`);
    }
  }
  spawnService('app', ['--filter', 'app', 'exec', 'next', 'start', '-p', PORT, '-H', '127.0.0.1']);
  await waitForApp(90000);
  check('boot.app', true, `app healthy on ${BASE}`);

  await exerciseKeyVault(sqlite);
  await exerciseEgress(db, sqlite);
  exerciseInPrepFilter();

  sqlite.close();
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
    process.stdout.write('\n=== slice-F exercise summary ===\n');
    const width = summary.reduce((max, row) => Math.max(max, row.step.length), 0);
    for (const row of summary) {
      process.stdout.write(`${row.ok ? 'PASS' : 'FAIL'}  ${row.step.padEnd(width)}  ${row.detail}\n`);
    }
    shutdownChildren();
    if (failures.length > 0) {
      process.stdout.write(`\n${failures.length} assertion(s) failed.\n`);
      process.exit(1);
    }
    process.stdout.write('\nAll slice-F exercise assertions passed.\n');
    process.exit(0);
  })
  .catch((error: unknown) => {
    process.stderr.write(`\nslice-F exercise error: ${error instanceof Error ? error.stack : String(error)}\n`);
    shutdownChildren();
    process.exit(1);
  });
