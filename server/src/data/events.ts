import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { dispatches, reviewEvents, reviews } from '../db/schema';
import { getCurrentFindings } from '../ledger';
import { requireReview } from './reviews';
import type { PersistedEvent } from './types';

const STREAMED_KINDS_LIST = [
  'phase_transition',
  'gate_verdict',
  'finding_recorded',
  'run_terminal',
  'web_query',
  'arbitration',
  'phase_critique',
  'error',
] as const;
const STREAMED_KINDS = new Set<string>(STREAMED_KINDS_LIST);

const PHASE_MEDIAN_SECONDS = 26;
const TOTAL_PHASES = 9;

function mapPersisted(row: typeof reviewEvents.$inferSelect): PersistedEvent | null {
  const payload = safeParse(row.payloadJson);
  switch (row.kind) {
    case 'phase_transition':
      if (payload.paused === true) {
        return { seq: row.seq, event: 'run_paused', data: { ts: row.ts, phase: row.phase, ...payload } };
      }
      return { seq: row.seq, event: 'phase_status', data: { ts: row.ts, phase: row.phase, status: 'active', ...payload } };
    case 'gate_verdict':
      return { seq: row.seq, event: 'gate_verdict', data: { ts: row.ts, phase: row.phase, ...payload } };
    case 'finding_recorded':
      return { seq: row.seq, event: 'finding_headline', data: payload };
    case 'run_terminal': {
      const outcome = (payload as { outcome?: string; released?: boolean }).outcome;
      const released = (payload as { released?: boolean }).released;
      const failed = outcome === 'failed' || outcome === 'cancelled' || released === false;
      return {
        seq: row.seq,
        event: failed ? 'run_failed' : 'run_complete',
        data: { phase: row.phase, ...payload },
      };
    }
    case 'web_query': {
      const blocked = (payload as { blocked?: boolean }).blocked === true;
      return {
        seq: row.seq,
        event: 'log_event',
        data: {
          ts: row.ts,
          kind: 'web_query',
          message: blocked
            ? `Citation lookup via ${row.egressTarget ?? 'unknown source'} blocked by the egress guard; the query text is withheld because it overlapped protected manuscript text`
            : `Citation lookup via ${row.egressTarget ?? 'unknown source'}: ${truncate(row.egressQuery ?? '', 100)}`,
        },
      };
    }
    case 'arbitration': {
      const outcome = (payload as { outcome?: string }).outcome ?? 'resolved';
      return {
        seq: row.seq,
        event: 'log_event',
        data: { ts: row.ts, kind: 'arbitration', message: `Gate arbitration: ${outcome}` },
      };
    }
    case 'phase_critique': {
      const headline = (payload as { headline?: string }).headline ?? 'Phase critic reviewed the phase outputs';
      return {
        seq: row.seq,
        event: 'log_event',
        data: { ts: row.ts, kind: 'phase_critique', message: truncate(headline, 160) },
      };
    }
    case 'error': {
      const message = (payload as { message?: string }).message ?? 'an error was recorded';
      return {
        seq: row.seq,
        event: 'log_event',
        data: { ts: row.ts, kind: 'error', message: `Error: ${truncate(message, 160)}` },
      };
    }
    default:
      return null;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
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
  const row = db
    .select({ seq: reviewEvents.seq })
    .from(reviewEvents)
    .where(and(eq(reviewEvents.reviewId, reviewId), inArray(reviewEvents.kind, [...STREAMED_KINDS_LIST])))
    .orderBy(desc(reviewEvents.seq))
    .limit(1)
    .all()[0];
  return row?.seq ?? 0;
}

export interface EphemeralEvent {
  event: string;
  data: unknown;
}

const EPHEMERAL_CACHE_TTL_MS = 2000;
const ephemeralCache = new WeakMap<object, Map<string, { seq: number; computedAt: number; events: EphemeralEvent[] }>>();

export function deriveEphemeral(db: MaraDatabase, reviewId: string): EphemeralEvent[] {
  const review = db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1).all()[0];
  if (review === undefined) {
    return [];
  }
  const currentMax = maxSeq(db, reviewId);
  let byReview = ephemeralCache.get(db);
  if (byReview === undefined) {
    byReview = new Map();
    ephemeralCache.set(db, byReview);
  }
  const cached = byReview.get(reviewId);
  if (cached !== undefined && cached.seq === currentMax && Date.now() - cached.computedAt < EPHEMERAL_CACHE_TTL_MS) {
    return [...cached.events];
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
    if (finding.scope === 'editor_only') {
      continue;
    }
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

  const recentDispatches = [...dispatchRows]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 20)
    .map((row) => ({
      id: row.id,
      ts: row.createdAt,
      agent: row.agent,
      phase: row.phase,
      status: row.status,
      latencyMs: row.latencyMs,
    }));
  out.push({ event: 'dispatch_log', data: { dispatches: recentDispatches } });

  byReview.set(reviewId, { seq: currentMax, computedAt: Date.now(), events: out });
  return [...out];
}

function phaseIndex(phase: string): number {
  const match = /phase_(\d)/.exec(phase);
  return match !== null ? Number.parseInt(match[1] as string, 10) : 0;
}

export function reviewTerminalState(db: MaraDatabase, reviewId: string): { terminal: boolean; status: string } {
  const review = requireReview(db, reviewId);
  return { terminal: ['completed', 'failed', 'cancelled'].includes(review.status), status: review.status };
}
