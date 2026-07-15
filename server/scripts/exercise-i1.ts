import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixturesDir, repoRoot } from '../src/paths';
import { artefactExists, readArtefact } from '../src/engine/artefacts';
import { scanMachineTokens } from '../src/engine/grounding';

const BASE = `http://127.0.0.1:${process.env.MARA_PORT ?? '3500'}`;
const PRESET = process.env.I1_PRESET ?? 'balanced';
const USER_PRIOR = process.env.I1_PRIOR ?? 'accept';
const REVIEW_TITLE = process.env.I1_TITLE ?? 'Workplace ACT and Wellbeing: A Full Review';
const PDF_FIXTURE = resolve(fixturesDir(), 'plos-0266357.pdf');
const OUT_DIR = resolve(repoRoot, 'data', `i1-${PRESET}`);
const FINDING_ID_TOKEN = /REV-[A-Z]{3,4}-\d{4}/g;
const POLL_MS = 10_000;
const MAX_WAIT_MS = 45 * 60 * 1000;

const failures: string[] = [];

function check(step: string, ok: boolean, detail: string): void {
  if (!ok) {
    failures.push(`${step}: ${detail}`);
  }
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${step}  ${detail}\n`);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

interface Question {
  id: string;
  default: string;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const existing = process.env.I1_REVIEW_ID;
  if (existing !== undefined && existing !== '') {
    await watchAndVerify(existing);
    return;
  }

  const created = await api<{ id: string }>('POST', '/api/reviews', { title: `I1 ${PRESET} verification` });
  const reviewId = created.json.id;
  check('create', created.status === 200 || created.status === 201, `review ${reviewId}`);

  const bytes = readFileSync(PDF_FIXTURE);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'plos-0266357.pdf');
  const up = await fetch(`${BASE}/api/reviews/${reviewId}/manuscript`, { method: 'POST', body: form });
  check('upload', up.ok, `HTTP ${up.status}`);

  let questions: Question[] = [];
  const qDeadline = Date.now() + 240_000;
  for (;;) {
    const q = await api<{ questions: Question[] }>('GET', `/api/reviews/${reviewId}/questions`);
    if (q.status === 200 && Array.isArray(q.json.questions)) {
      questions = q.json.questions;
      break;
    }
    if (Date.now() > qDeadline) {
      check('questions', false, `not ready after 240s (last HTTP ${q.status})`);
      process.exit(1);
    }
    await delay(5000);
  }
  const ids = questions.map((q) => q.id);
  check('questions', true, ids.join(','));
  for (const wanted of ['review-title', 'paper-type', 'reference-audit', 'claim-check', 'ai-detection', 'user-prior']) {
    check(`question.${wanted}`, ids.includes(wanted), ids.includes(wanted) ? 'present' : 'MISSING');
  }

  const overrides: Record<string, string> = {
    preset: PRESET,
    'review-title': REVIEW_TITLE,
    'reference-audit': 'forensic',
    'claim-check': 'yes',
    'ai-detection': 'yes',
    'user-prior': USER_PRIOR,
  };
  const answers = questions.map((q) => ({ questionId: q.id, value: overrides[q.id] ?? q.default }));
  if (!answers.some((a) => a.questionId === 'preset')) {
    answers.push({ questionId: 'preset', value: PRESET });
  }
  const ans = await api('POST', `/api/reviews/${reviewId}/answers`, { answers });
  check('answers', ans.status === 200, `HTTP ${ans.status}`);
  await watchAndVerify(reviewId);
}

async function watchAndVerify(reviewId: string): Promise<void> {
  let lastPhase = '';
  let status = '';
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    const detail = await api<{ status: string; currentPhase: string | null; recommendation: string | null; title: string }>(
      'GET',
      `/api/reviews/${reviewId}`,
    );
    status = detail.json.status;
    const phase = detail.json.currentPhase ?? '';
    if (phase !== lastPhase) {
      process.stdout.write(`  ... ${status} ${phase} ${new Date().toISOString()}\n`);
      lastPhase = phase;
    }
    if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'paused') {
      break;
    }
    if (Date.now() > deadline) {
      check('run', false, `timeout after 45 min at ${status}/${phase}`);
      process.exit(1);
    }
    await delay(POLL_MS);
  }
  check('run', status === 'completed', `final status ${status} at ${lastPhase}`);
  if (status !== 'completed') {
    process.exit(1);
  }

  const detail = await api<{ recommendation: string | null; recommendationConfidence: number | null; title: string }>(
    'GET',
    `/api/reviews/${reviewId}`,
  );
  check('title', detail.json.title === REVIEW_TITLE, `review title "${detail.json.title}"`);
  process.stdout.write(`recommendation: ${detail.json.recommendation} @ ${detail.json.recommendationConfidence}\n`);

  const stats = await api<{ costUsd: number; tokensIn: number; tokensOut: number }>('GET', `/api/reviews/${reviewId}/stats`);
  process.stdout.write(`cost ${stats.json.costUsd} USD, in ${stats.json.tokensIn}, out ${stats.json.tokensOut}\n`);

  check('shippedArtefact', artefactExists(reviewId, 'p7-shipped-final'), 'p7-shipped-final');
  const shipped = readArtefact<{
    bodyMarkdown: string;
    evidenceMap: Array<{ section: string; label: string; findingIds: string[] }>;
    references: string[];
    humanizePairs: Array<{ before: string; after: string }>;
  }>(reviewId, 'p7-shipped-final');
  const body = shipped.bodyMarkdown;
  writeFileSync(resolve(OUT_DIR, 'letter.md'), body);

  const inlineIds = body.match(FINDING_ID_TOKEN) ?? [];
  check('idFreeProse', inlineIds.length === 0, inlineIds.length === 0 ? 'zero REV tokens' : inlineIds.slice(0, 5).join(','));
  const tokens = scanMachineTokens(body);
  check('machineTokens', tokens.length === 0, tokens.length === 0 ? 'clean' : tokens.slice(0, 5).join(';'));
  const words = body.split(/\s+/).filter(Boolean).length;
  check('wordBudget', words >= 1600 && words <= 4200, `${words} words total doc (2000-2500 narrative band, critic-enforced)`);
  check('fourA', body.includes('4A'), body.includes('4A') ? '4A present' : 'missing 4A');
  check('fourB', body.includes('4B'), body.includes('4B') ? '4B present' : 'missing 4B');
  check('discussion', /###?\s*.*Discussion/i.test(body), 'Discussion subsection');
  check('evidenceMap', shipped.evidenceMap.length >= 5, `${shipped.evidenceMap.length} entries`);
  const labelsOk = shipped.evidenceMap.every((e) => body.includes(`**${e.label}`));
  check('mapLabels', labelsOk, labelsOk ? 'every label bold in body' : 'label missing from body');
  check('humanizePairs', shipped.humanizePairs.length >= 3, `${shipped.humanizePairs.length} pairs`);
  check('references', shipped.references.length > 0, `${shipped.references.length} references`);

  if (artefactExists(reviewId, 'p2-context')) {
    const dossier = readArtefact<{ keyPapers?: Array<{ citation: string }> }>(reviewId, 'p2-context');
    const keyPapers = dossier.keyPapers ?? [];
    check('dossier', keyPapers.length > 0, `${keyPapers.length} key papers`);
    const surnames = keyPapers
      .map((p) => (p.citation.match(/^([A-Z][A-Za-z-]+)/) ?? [])[1])
      .filter((s): s is string => typeof s === 'string' && s.length > 3);
    const engaged = surnames.filter((s) => body.includes(s));
    check('literatureEngaged', engaged.length >= 1, engaged.length > 0 ? `letter names: ${engaged.slice(0, 4).join(', ')}` : `none of ${surnames.slice(0, 6).join(',')} in letter`);
  } else {
    check('dossier', false, 'p2-context artefact missing');
  }

  const evidence = await api<{
    evidenceMap: unknown[];
    findings: Array<{ id: string }>;
    priorStressTest: { prior: string; alignment: string; caseFor: string; caseAgainst: string; hingeFindingIds: string[] } | null;
  }>('GET', `/api/reviews/${reviewId}/evidence`);
  check('evidenceEndpoint', evidence.status === 200, `HTTP ${evidence.status}`);
  check('evidenceServed', (evidence.json.evidenceMap ?? []).length > 0, `${(evidence.json.evidenceMap ?? []).length} map entries served`);
  const pst = evidence.json.priorStressTest;
  check('priorStress', pst !== null && pst !== undefined, pst ? `alignment=${pst.alignment} prior=${pst.prior}` : 'missing');
  if (pst) {
    check('priorTested', ['supported', 'partially_supported', 'contradicted'].includes(pst.alignment), pst.alignment);
    const pstIds = (pst.caseFor + pst.caseAgainst).match(FINDING_ID_TOKEN) ?? [];
    const served = new Set(evidence.json.findings.map((f) => f.id));
    const leaked = pstIds.filter((id) => !served.has(id));
    check('priorNoLeak', leaked.length === 0, leaked.length === 0 ? 'prose ids all author-facing' : leaked.join(','));
  }

  const dl = await api<{ deliverables: Array<{ kind: string; format: string; sizeBytes?: number }> } | Array<{ kind: string }>>(
    'GET',
    `/api/reviews/${reviewId}/deliverables`,
  );
  check('deliverables', dl.status === 200, `HTTP ${dl.status}`);
  const reportRes = await fetch(`${BASE}/api/reviews/${reviewId}/deliverables/peer_review_report?format=docx`);
  if (reportRes.ok) {
    const buf = Buffer.from(await reportRes.arrayBuffer());
    writeFileSync(resolve(OUT_DIR, 'peer-review-report.docx'), buf);
    check('docxSize', buf.length > 5_000 && buf.length < 80_000, `${(buf.length / 1024).toFixed(1)} KB`);
  } else {
    check('docxSize', false, `download HTTP ${reportRes.status}`);
  }

  process.stdout.write(`\nreview ${reviewId} letter saved to ${OUT_DIR}\n`);
  if (failures.length > 0) {
    process.stdout.write(`\nFAILURES (${failures.length}):\n${failures.join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write('\nALL CHECKS PASS\n');
}

main().catch((error) => {
  process.stdout.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
