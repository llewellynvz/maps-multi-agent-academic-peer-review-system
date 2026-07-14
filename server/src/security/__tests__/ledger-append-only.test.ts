import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type SqliteConnection } from '../../db/client';
import { runMigrations } from '../../db/migrate';

let tempDir: string;
let sqlite: SqliteConnection;

function insertReview(id: string, slug: string): void {
  const now = new Date().toISOString();
  sqlite.prepare('INSERT INTO reviews (id, slug, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, slug, now, now);
}

function insertFinding(id: string, reviewId: string, claim: string, supersedesId: string | null): void {
  sqlite
    .prepare(
      `INSERT INTO findings
       (id, review_id, agent, phase, type, claim, manuscript_anchor, epistemic_status,
        confidence, confidence_band, severity, fixability, scope, supersedes_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      reviewId,
      'specialist-stat',
      'phase_3',
      'analysis',
      claim,
      'p. 4, line 12',
      'Known',
      0.9,
      'Yellow',
      'minor',
      'easy',
      'author_facing',
      supersedesId,
      new Date().toISOString(),
    );
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-ledger-'));
  const client = createDb(join(tempDir, 'mara.db'));
  sqlite = client.sqlite;
  runMigrations(client.db);
  insertReview('rev-1', 'ledger-suite');
  insertFinding('REV-STAT-0001', 'rev-1', 'The original claim.', null);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('ledger append-only suite (DATA-11..DATA-13, SEC-30)', () => {
  it('raises on a direct UPDATE against findings', () => {
    expect(() =>
      sqlite.prepare('UPDATE findings SET claim = ? WHERE id = ?').run('rewritten', 'REV-STAT-0001'),
    ).toThrow(/append-only/);
  });

  it('raises on a direct DELETE against findings', () => {
    expect(() => sqlite.prepare('DELETE FROM findings WHERE id = ?').run('REV-STAT-0001')).toThrow(/append-only/);
  });

  it('expresses a correction only as a new superseding row', () => {
    insertFinding('REV-STAT-0002', 'rev-1', 'The corrected claim.', 'REV-STAT-0001');
    const current = sqlite
      .prepare("SELECT id, claim FROM v_current_findings WHERE review_id = ? ORDER BY id")
      .all('rev-1') as Array<{ id: string; claim: string }>;
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ id: 'REV-STAT-0002', claim: 'The corrected claim.' });
  });
});
