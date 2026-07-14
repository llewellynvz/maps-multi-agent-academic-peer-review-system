import { and, eq, gt } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { dispatches, reviewEvents, reviews } from '../db/schema';
import { getCurrentFindings } from '../ledger';
import { requireReview } from './reviews';
import type { PersistedEvent } from './types';

const STREAMED_KINDS = new Set(['phase_transition', 'gate_verdict', 'finding_recorded', 'run_terminal']);

const PHASE_MEDIAN_SECONDS = 26;
const TOTAL_PHASES = 9;

function mapPersisted(row: typeof reviewEvents.$inferSelect): PersistedEvent | null {
  const payload = safeParse(row.payloadJson);
  switch (row.kind) {
    case 'phase_transition':
      return { seq: row.seq, event: 'phase_status', data: { phase: row.phase, status: 'active', ...payload } };
    case 'gate_verdict':
      return { seq: row.seq, event: 'gate_verdict', data: { phase: row.phase, ...payload } };
    case 'finding_recorded':
      return { seq: row.seq, event: 'finding_headline', data: payload };
    case 'run_terminal': {
      const outcome = (payload as { outcome?: string; released?: boolean }).outcome;
      const released = (payload as { released?: boolean }).released;
      const failed = outcome === 'failed' || outcome === 'cancelled' || released === false;
      return {
        seq: row.seq,
        event: failed ? 'run_failed' : 'run_complete',
        data: payload,
      };
    }
    default:
      return null;
  }
}

function safeParse(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function replayEvents(db: MaraDatabase, reviewId: string, afterSeq: number): PersistedEvent[] {
  const rows = db
    .select()
    .from(reviewEvents)
    .where(and(eq(reviewEvents.reviewId, reviewId), gt(reviewEvents.seq, afterSeq)))
    .all()
    .sort((a, b) => a.seq - b.seq);
  const out: PersistedEvent[] = [];
  for (const row of rows) {
    if (!STREAMED_KINDS.has(row.kind)) {
      continue;
    }
    const mapped = mapPersisted(row);
    if (mapped !== null) {
      out.push(mapped);
    }
  }
  return out;
}

export function maxSeq(db: MaraDatabase, reviewId: string): number {
  const rows = db
    .select({ seq: reviewEvents.seq, kind: reviewEvents.kind })
    .from(reviewEvents)
    .where(eq(reviewEvents.reviewId, reviewId))
    .all();
  return rows.reduce((max, row) => (STREAMED_KINDS.has(row.kind) && row.seq > max ? row.seq : max), 0);
}

export interface EphemeralEvent {
  event: string;
  data: unknown;
}

export function deriveEphemeral(db: MaraDatabase, reviewId: string): EphemeralEvent[] {
  const review = db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1).all()[0];
  if (review === undefined) {
    return [];
  }
  const phase = review.currentPhase ?? 'phase_0';
  const out: EphemeralEvent[] = [];

  const dispatchRows = db.select().from(dispatches).where(eq(dispatches.reviewId, reviewId)).all();
  const cost = dispatchRows.reduce(
    (acc, row) => {
      acc.costUsdTotal += row.costUsd;
      acc.tokensIn += row.tokensIn;
      acc.tokensOut += row.tokensOut;
      return acc;
    },
    { costUsdTotal: 0, tokensIn: 0, tokensOut: 0 },
  );
  out.push({ event: 'cost_tick', data: { ...cost, phase } });

  const findings = getCurrentFindings(db, reviewId);
  const byLens = new Map<string, number>();
  for (const finding of findings) {
    const lens = finding.id.split('-')[1] ?? 'GEN';
    byLens.set(lens, (byLens.get(lens) ?? 0) + 1);
  }
  const specialistDone = review.status === 'completed' || phaseIndex(phase) > 3;
  for (const [lens, count] of byLens) {
    out.push({
      event: 'lens_status',
      data: { lens, status: specialistDone ? 'done' : 'active', findingsCount: count },
    });
  }

  const completedPhases = phaseIndex(phase);
  const remaining = Math.max(0, TOTAL_PHASES - completedPhases);
  out.push({
    event: 'eta_update',
    data: { etaSeconds: remaining * PHASE_MEDIAN_SECONDS, basis: 'bundled median' },
  });

  return out;
}

function phaseIndex(phase: string): number {
  const match = /phase_(\d)/.exec(phase);
  return match !== null ? Number.parseInt(match[1] as string, 10) : 0;
}

export function reviewTerminalState(db: MaraDatabase, reviewId: string): { terminal: boolean; status: string } {
  const review = requireReview(db, reviewId);
  return { terminal: ['completed', 'failed', 'cancelled'].includes(review.status), status: review.status };
}
