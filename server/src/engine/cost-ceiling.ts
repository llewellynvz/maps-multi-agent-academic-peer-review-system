import { eq } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { dispatches } from '../db/schema';
import { COST_CEILING_SETTING_KEY, readSetting } from '../data/settings-store';
import { getReviewOptions } from '../workflow/repo';
import type { PreDispatchGate } from './phases-shared';

export { COST_CEILING_SETTING_KEY };
export const DEFAULT_PROJECTED_DISPATCH_USD = 0.05;

export interface CostCeilingGateOptions {
  db: MaraDatabase;
  defaultProjectedUsd?: number;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function resolveCeiling(db: MaraDatabase, reviewId: string): number | undefined {
  const perRun = positiveNumber(getReviewOptions(db, reviewId).costCeilingUsd);
  if (perRun !== undefined) {
    return perRun;
  }
  return positiveNumber(readSetting<unknown>(db, COST_CEILING_SETTING_KEY));
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
    const rows = db.select({ cost: dispatches.costUsd }).from(dispatches).where(eq(dispatches.reviewId, info.reviewId)).all();
    const spent = rows.reduce((sum, row) => sum + row.cost, 0);
    const perDispatch = rows.length > 0 ? spent / rows.length : defaultProjectedUsd;
    const inFlight = Math.max(0, (approvals.get(info.reviewId) ?? 0) - rows.length);
    const projected = perDispatch * (inFlight + 1);
    if (spent + projected > ceiling) {
      return {
        pause: true,
        reason: 'cost_ceiling',
        detail: {
          spentUsd: Math.round(spent * 1_000_000) / 1_000_000,
          projectedUsd: Math.round(projected * 1_000_000) / 1_000_000,
          ceilingUsd: ceiling,
        },
      };
    }
    approvals.set(info.reviewId, rows.length + inFlight + 1);
    return { pause: false };
  };
}
