import Database from 'better-sqlite3';
import { maraDbPath } from '../src/paths';

const arg = process.argv[2];
if (arg === undefined || arg === '') {
  console.error('usage: tsx scripts/trace-review.ts <reviewId or prefix>');
  process.exit(1);
}

const db = new Database(maraDbPath(), { readonly: true });

const review = db
  .prepare('SELECT * FROM reviews WHERE id = ? OR id LIKE ? LIMIT 1')
  .get(arg, `${arg}%`) as Record<string, unknown> | undefined;

if (review === undefined) {
  console.error(`no review matches "${arg}"`);
  process.exit(1);
}

const id = review.id as string;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function summarise(kind: string, payloadJson: string): string {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return '';
  }
  switch (kind) {
    case 'phase_transition':
      return payload.paused === true ? `paused: ${String(payload.reason ?? '')}` : `verdict=${String(payload.verdict ?? '')}`;
    case 'gate_verdict':
      return `cycle ${String(payload.cycle ?? '')} ${String(payload.source ?? '')} -> ${String(payload.verdict ?? '')}`;
    case 'arbitration':
      return `${String(payload.outcome ?? '')}: ${truncate(String(payload.rationale ?? ''), 80)}`;
    case 'run_terminal':
      return `${String(payload.outcome ?? (payload.released === false ? 'failed' : 'complete'))}${payload.errorClass ? ` [${String(payload.errorClass)}]` : ''}${payload.message ? `: ${truncate(String(payload.message), 90)}` : ''}`;
    case 'finding_recorded':
      return `${String(payload.severity ?? '')} ${String(payload.findingId ?? '')}`;
    case 'error':
      return truncate(String(payload.message ?? payload.reason ?? ''), 90);
    case 'phase_critique':
      return truncate(String(payload.headline ?? ''), 90);
    default:
      return '';
  }
}

console.log(`\nReview ${id}`);
console.log(`  title:          ${String(review.title ?? '(untitled)')}`);
console.log(`  status:         ${String(review.status)}  phase=${String(review.current_phase ?? '-')}  error=${String(review.error_class ?? 'none')}`);
console.log(`  recommendation: ${String(review.recommendation ?? '-')} @ ${String(review.recommendation_confidence ?? '-')}`);

console.log('\nDispatches (agent · phase · status · latency · cost):');
const dispatches = db
  .prepare('SELECT agent, phase, status, latency_ms, cost_usd, tokens_in, tokens_out FROM dispatches WHERE review_id = ? ORDER BY created_at')
  .all(id) as Array<Record<string, unknown>>;
let totalCost = 0;
for (const d of dispatches) {
  totalCost += Number(d.cost_usd ?? 0);
  console.log(
    `  ${String(d.agent).padEnd(24)} ${String(d.phase ?? '').padEnd(9)} ${String(d.status).padEnd(8)} ${String(d.latency_ms ?? '-').padStart(7)}ms  $${Number(d.cost_usd ?? 0).toFixed(4)}`,
  );
}
console.log(`  total: ${dispatches.length} dispatches, $${totalCost.toFixed(4)}`);

console.log('\nEvent timeline:');
const events = db
  .prepare('SELECT seq, ts, kind, phase, payload_json FROM review_events WHERE review_id = ? ORDER BY seq')
  .all(id) as Array<Record<string, unknown>>;
for (const e of events) {
  const summary = summarise(String(e.kind), String(e.payload_json ?? '{}'));
  console.log(`  #${String(e.seq).padStart(3)} ${String(e.kind).padEnd(17)} ${String(e.phase ?? '').padEnd(9)} ${summary}`);
}

const gate = db
  .prepare("SELECT snapshot_json FROM phase_checkpoints WHERE review_id = ? AND phase = 'engine_phase_7'")
  .get(id) as { snapshot_json?: string } | undefined;
if (gate?.snapshot_json !== undefined) {
  try {
    const snap = JSON.parse(gate.snapshot_json) as { scrubbedTokens?: unknown };
    if (Array.isArray(snap.scrubbedTokens) && snap.scrubbedTokens.length > 0) {
      console.log('\nDeterministic scrub removed:');
      for (const token of snap.scrubbedTokens) {
        console.log(`  - ${truncate(String(token), 40)}`);
      }
    }
  } catch {
    // no scrub trace
  }
}

console.log('');
db.close();
