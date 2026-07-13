import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Finding } from '@mara/shared';
import { createDb, type MaraDatabase, type SqliteConnection } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { getCurrentFindings } from '../../ledger';
import { blobDir } from '../../paths';
import { mergeFindingsOnce } from '../merge';

let tempDir: string;
let db: MaraDatabase;
let sqlite: SqliteConnection;
let reviewId: string;

function finding(overrides: Partial<Finding> = {}): unknown {
  return {
    id: 'REV-XXX-0001',
    lens: 'statistical',
    phase: 3,
    claim: 'A statistical concern.',
    anchor: 'Table 2',
    epistemic: 'Known',
    confidence: 0.9,
    band: 'Yellow',
    severity: 'major',
    fixability: 'moderate',
    scope: 'both',
    failureScenario: 'A validity threat.',
    leanestFix: 'Recompute.',
    supersedes: null,
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-merge-'));
  const client = createDb(join(tempDir, 'mara.db'));
  db = client.db;
  sqlite = client.sqlite;
  runMigrations(db);
  reviewId = `merge-idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  sqlite.prepare('INSERT INTO reviews (id, slug, created_at, updated_at) VALUES (?, ?, ?, ?)').run(reviewId, reviewId, now, now);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(blobDir(reviewId), { recursive: true, force: true });
});

describe('idempotent ledger merge on phase re-entry', () => {
  it('merges once even when the same marker is replayed after a mid-phase re-run', () => {
    const input = {
      reviewId,
      lensPrefix: 'STAT',
      phase: 'phase_3',
      agent: 'specialist-reviewer',
      fragments: [finding()],
      marker: 'p3-STAT-first',
    };
    const first = mergeFindingsOnce(db, input);
    const second = mergeFindingsOnce(db, input);
    expect(first).toEqual(['REV-STAT-0001']);
    expect(second).toEqual([]);
    expect(getCurrentFindings(db, reviewId)).toHaveLength(1);
  });

  it('keeps distinct markers independent so different agents still merge', () => {
    mergeFindingsOnce(db, {
      reviewId,
      lensPrefix: 'STAT',
      phase: 'phase_3',
      agent: 'specialist-reviewer',
      fragments: [finding()],
      marker: 'p3-STAT-first',
    });
    mergeFindingsOnce(db, {
      reviewId,
      lensPrefix: 'STAT',
      phase: 'phase_3',
      agent: 'specialist-reviewer',
      fragments: [finding({ claim: 'A challenge-round update.' })],
      marker: 'p3-STAT-challenge',
    });
    expect(getCurrentFindings(db, reviewId)).toHaveLength(2);
  });
});
