import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MaraDatabase, type SqliteConnection } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { DispatchPauseError } from '../phases-shared';
import { settleWithGaps } from '../phases';

let tempDir: string;
let db: MaraDatabase;
let sqlite: SqliteConnection;
let reviewId: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-settle-'));
  const client = createDb(join(tempDir, 'mara.db'));
  db = client.db;
  sqlite = client.sqlite;
  runMigrations(db);
  reviewId = `settle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  sqlite
    .prepare('INSERT INTO reviews (id, slug, status, options_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(reviewId, reviewId, 'running', JSON.stringify({}), now, now);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function gapEvents(): Array<{ unit: string; step: string }> {
  return (
    sqlite.prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'error'").all(reviewId) as Array<{
      payload_json: string;
    }>
  )
    .map((row) => JSON.parse(row.payload_json) as { coverageGap?: boolean; unit: string; step: string })
    .filter((payload) => payload.coverageGap === true);
}

describe('settleWithGaps', () => {
  it('returns every result and records no gap when all units succeed', async () => {
    const { results, gaps } = await settleWithGaps(db, reviewId, 'phase_3', 'test step', [
      { label: 'A', run: () => Promise.resolve(1) },
      { label: 'B', run: () => Promise.resolve(2) },
    ]);
    expect([...results].sort()).toEqual([1, 2]);
    expect(gaps).toEqual([]);
    expect(gapEvents()).toEqual([]);
  });

  it('skips a failed unit, records a traceable gap without the raw error, and continues', async () => {
    const { results, gaps } = await settleWithGaps(db, reviewId, 'phase_3', 'test step', [
      { label: 'A', run: () => Promise.resolve(1) },
      { label: 'B', run: () => Promise.reject(new Error('boom-manuscript-detail')) },
    ]);
    expect(results).toEqual([1]);
    expect(gaps).toEqual([{ step: 'test step', unit: 'B' }]);
    const events = gapEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.unit).toBe('B');
    expect(JSON.stringify(events[0])).not.toContain('boom-manuscript-detail');
  });

  it('returns an empty result set when every unit fails, so the caller can decide criticality', async () => {
    const { results, gaps } = await settleWithGaps(db, reviewId, 'phase_4', 'test step', [
      { label: 'A', run: () => Promise.reject(new Error('x')) },
      { label: 'B', run: () => Promise.reject(new Error('y')) },
    ]);
    expect(results).toEqual([]);
    expect(gaps.map((gap) => gap.unit).sort()).toEqual(['A', 'B']);
  });

  it('propagates a cost-ceiling pause and records no gap even when a sibling failed first', async () => {
    await expect(
      settleWithGaps(db, reviewId, 'phase_3', 'test step', [
        { label: 'A', run: () => Promise.reject(new Error('ordinary')) },
        { label: 'B', run: () => Promise.reject(new DispatchPauseError('cost_ceiling')) },
      ]),
    ).rejects.toBeInstanceOf(DispatchPauseError);
    expect(gapEvents()).toEqual([]);
  });
});
