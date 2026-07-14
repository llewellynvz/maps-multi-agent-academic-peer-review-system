import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, openSqlite, type SqliteConnection } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { insertEvent } from '../repo';

let tempDir: string;
let dbPath: string;
const reviewId = 'rev-txn';

function seedReview(): void {
  const seed = createDb(dbPath);
  runMigrations(seed.db);
  const now = new Date().toISOString();
  seed.sqlite
    .prepare('INSERT INTO reviews (id, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(reviewId, reviewId, 'running', now, now);
  seed.sqlite.close();
}

function rawInsert(conn: SqliteConnection, seq: number): void {
  conn
    .prepare("INSERT INTO review_events (id, review_id, seq, ts, kind) VALUES (?, ?, ?, ?, 'phase_transition')")
    .run(randomUUID(), reviewId, seq, new Date().toISOString());
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-ev-txn-'));
  dbPath = join(tempDir, 'mara.db');
  seedReview();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('insertEvent transaction isolation (B2/F12)', () => {
  it('a deferred read-then-write fails with SQLITE_BUSY_SNAPSHOT under an interleaved commit', () => {
    const a = openSqlite(dbPath);
    const b = openSqlite(dbPath);
    try {
      a.prepare('BEGIN DEFERRED').run();
      a.prepare('SELECT max(seq) AS m FROM review_events WHERE review_id = ?').get(reviewId);
      rawInsert(b, 1);
      let code: string | undefined;
      try {
        rawInsert(a, 2);
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code).toBe('SQLITE_BUSY_SNAPSHOT');
    } finally {
      try {
        a.prepare('ROLLBACK').run();
      } catch {
        /* transaction already unwound */
      }
      a.close();
      b.close();
    }
  });

  it('the immediate insertEvent path re-reads under the write lock and appends cleanly', () => {
    const a = createDb(dbPath);
    const b = createDb(dbPath);
    try {
      const seqB = insertEvent(b.db, { reviewId, kind: 'phase_transition' });
      const seqA = insertEvent(a.db, { reviewId, kind: 'gate_verdict' });
      expect(seqB).toBe(1);
      expect(seqA).toBe(2);
    } finally {
      a.sqlite.close();
      b.sqlite.close();
    }
  });
});
