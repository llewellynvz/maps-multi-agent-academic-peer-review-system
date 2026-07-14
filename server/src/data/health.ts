import { sql } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { workerIsUp } from './heartbeat';

export const VERSION = '0.1.0-slice-e';

export interface HealthReport {
  status: 'ok';
  version: string;
  worker: 'up' | 'down';
  db: 'ok' | 'error';
}

export function health(db: MaraDatabase): HealthReport {
  let dbStatus: 'ok' | 'error' = 'ok';
  try {
    db.all(sql`SELECT 1`);
  } catch {
    dbStatus = 'error';
  }
  return {
    status: 'ok',
    version: VERSION,
    worker: workerIsUp() ? 'up' : 'down',
    db: dbStatus,
  };
}
