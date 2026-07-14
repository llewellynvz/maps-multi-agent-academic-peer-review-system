import { sql } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { COST_CEILING_SETTING_KEY, positiveUsd, readSetting } from '../data/settings-store';
import { getReviewOptions } from '../workflow/repo';
import type { PreDispatchGate } from './phases-shared';

const DEFAULT_PROJECTED_DISPATCH_USD = 0.05;

export interface CostCeilingGateOptions {
  db: MaraDatabase;
  defaultProjectedUsd?: number;
}

function resolveCeiling(db: MaraDatabase, reviewId: string): number | undefined {
  const perRun = positiveUsd(getReviewOptions(db, reviewId).costCeilingUsd);
  if (perRun !== undefined) {
    return perRun;
  }
  return positiveUsd(readSetting<unknown>(db, COST_CEILING_SETTING_KEY));
}

export function createCostCeilingGate(options: CostCeilingGateOptions): PreDispatchGate {
  const { db } = options;
  const defaultProjectedUsd = options.defaultProjectedUsd ?? DEFAULT_PROJECTED_DISPATCH_USD;
  const approvals = new Map<string, number>();
  return (info) => {
    const ceiling = resolveCeiling(db, info.reviewId);
    if (ceiling === undefined) {
      return { pause: false };
    }
    for (const key of approvals.keys()) {
      if (key !== info.reviewId) {
        approvals.delete(key);
      }
    }
    const row = db.all(
      sql`SELECT count(*) AS n, coalesce(sum(cost_usd), 0) AS spent, coalesce(max(cost_usd), 0) AS maxCost
          FROM dispatches WHERE review_id = ${info.reviewId}`,
    )[0] as { n: number; spent: number; maxCost: number };
    const perDispatch = row.maxCost > 0 ? row.maxCost : defaultProjectedUsd;
    const inFlight = Math.max(0, (approvals.get(info.reviewId) ?? 0) - row.n);
    const projected = perDispatch * (inFlight + 1);
    if (row.spent + projected > ceiling) {
      return {
        pause: true,
        reason: 'cost_ceiling',
        detail: {
          spentUsd: Math.round(row.spent * 1_000_000) / 1_000_000,
          projectedUsd: Math.round(projected * 1_000_000) / 1_000_000,
          ceilingUsd: ceiling,
        },
      };
    }
    approvals.set(info.reviewId, row.n + inFlight + 1);
    return { pause: false };
  };
}
