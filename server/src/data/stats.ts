import { sql } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { requireReview } from './reviews';
import type { InstanceStats, RunStats } from './types';

interface DispatchAggregate {
  count: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  retries: number;
}

function aggregate(db: MaraDatabase, reviewId: string): DispatchAggregate {
  const row = db.all(
    sql`SELECT count(*) AS count, coalesce(sum(cost_usd),0) AS costUsd, coalesce(sum(tokens_in),0) AS tokensIn,
        coalesce(sum(tokens_out),0) AS tokensOut, coalesce(sum(tokens_cached),0) AS tokensCached,
        coalesce(sum(retries),0) AS retries
        FROM dispatches WHERE review_id = ${reviewId}`,
  )[0] as DispatchAggregate;
  return row;
}

export function getRunStats(db: MaraDatabase, reviewId: string): RunStats {
  requireReview(db, reviewId);
  const totals = aggregate(db, reviewId);
  const phaseRows = db.all(
    sql`SELECT phase, coalesce(sum(cost_usd),0) AS cost FROM dispatches WHERE review_id = ${reviewId} GROUP BY phase`,
  ) as Array<{ phase: string; cost: number }>;
  const costByPhase: Record<string, number> = {};
  for (const row of phaseRows) {
    costByPhase[row.phase] = row.cost;
  }

  const timing = db.all(
    sql`SELECT started_at AS startedAt, completed_at AS completedAt FROM reviews WHERE id = ${reviewId}`,
  )[0] as { startedAt: string | null; completedAt: string | null } | undefined;
  let timeToFirstReviewMs: number | null = null;
  if (timing?.startedAt != null && timing.completedAt != null) {
    timeToFirstReviewMs = new Date(timing.completedAt).getTime() - new Date(timing.startedAt).getTime();
  }

  return {
    costUsd: totals.costUsd,
    costByPhase,
    tokensIn: totals.tokensIn,
    tokensOut: totals.tokensOut,
    tokensCached: totals.tokensCached,
    retryRate: totals.count > 0 ? totals.retries / totals.count : 0,
    timeToFirstReviewMs,
  };
}

export function getInstanceStats(db: MaraDatabase): InstanceStats {
  const reviewCounts = db.all(
    sql`SELECT count(*) AS total, coalesce(sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END),0) AS completed
        FROM reviews`,
  )[0] as { total: number; completed: number };
  const dispatch = db.all(
    sql`SELECT coalesce(sum(cost_usd),0) AS cost, count(*) AS count, coalesce(sum(retries),0) AS retries FROM dispatches`,
  )[0] as { cost: number; count: number; retries: number };
  const timing = db.all(
    sql`SELECT avg((julianday(completed_at) - julianday(started_at)) * 86400000) AS avgMs
        FROM reviews WHERE status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL`,
  )[0] as { avgMs: number | null };

  const runCount = reviewCounts.total;
  return {
    costPerRun: runCount > 0 ? dispatch.cost / runCount : 0,
    completionRate: runCount > 0 ? reviewCounts.completed / runCount : 0,
    retryRate: dispatch.count > 0 ? dispatch.retries / dispatch.count : 0,
    timeToFirstReviewMs: timing.avgMs ?? null,
    runCount,
  };
}
