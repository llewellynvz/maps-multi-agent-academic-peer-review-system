import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, openSqlite, type SqliteConnection } from '../client';
import { runMigrations } from '../migrate';

let tempDir: string;
let dbPath: string;
const openConnections: SqliteConnection[] = [];

function track(connection: SqliteConnection): SqliteConnection {
  openConnections.push(connection);
  return connection;
}

function migratedConnection(): SqliteConnection {
  const { db, sqlite } = createDb(dbPath);
  track(sqlite);
  runMigrations(db);
  return sqlite;
}

function insertReview(connection: SqliteConnection, id: string, slug: string): void {
  const now = new Date().toISOString();
  connection.prepare('INSERT INTO reviews (id, slug, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, slug, now, now);
}

function insertFinding(
  connection: SqliteConnection,
  id: string,
  reviewId: string,
  supersedesId: string | null,
): void {
  connection
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
      'A claim about the manuscript.',
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
  tempDir = mkdtempSync(join(tmpdir(), 'mara-db-'));
  dbPath = join(tempDir, 'mara.db');
});

afterEach(() => {
  for (const connection of openConnections.splice(0)) {
    connection.close();
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe('migration', () => {
  it('creates all eleven tables and the current-findings view', () => {
    const sqlite = migratedConnection();

    const objects = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
      .all() as Array<{ name: string }>;
    const names = new Set(objects.map((row) => row.name));

    const expectedTables = [
      'reviews',
      'manuscripts',
      'findings',
      'phase_checkpoints',
      'review_events',
      'dispatches',
      'rubric_scores',
      'deliverables',
      'provider_keys',
      'settings',
      'run_commands',
    ];
    for (const table of expectedTables) {
      expect(names.has(table)).toBe(true);
    }
    expect(names.has('v_current_findings')).toBe(true);
  });
});

describe('append-only ledger', () => {
  it('blocks UPDATE and unguarded DELETE, and permits a guarded purge DELETE', () => {
    const sqlite = migratedConnection();
    insertReview(sqlite, 'rev-1', 'slug-1');
    insertFinding(sqlite, 'REV-STAT-0001', 'rev-1', null);

    expect(() =>
      sqlite.prepare('UPDATE findings SET claim = ? WHERE id = ?').run('changed', 'REV-STAT-0001'),
    ).toThrow(/append-only/);

    expect(() => sqlite.prepare('DELETE FROM findings WHERE id = ?').run('REV-STAT-0001')).toThrow(/append-only/);

    sqlite.exec('CREATE TEMP TABLE _mara_purge (id INTEGER)');
    const result = sqlite.prepare('DELETE FROM findings WHERE id = ?').run('REV-STAT-0001');
    expect(result.changes).toBe(1);
    sqlite.exec('DROP TABLE _mara_purge');
  });
});

describe('WAL concurrency', () => {
  it('allows a concurrent reader during a write transaction', () => {
    const writer = migratedConnection();
    insertReview(writer, 'rev-1', 'slug-1');

    const reader = track(openSqlite(dbPath));

    expect(writer.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(reader.pragma('journal_mode', { simple: true })).toBe('wal');

    writer.exec('BEGIN IMMEDIATE');
    insertReview(writer, 'rev-2', 'slug-2');

    const duringWrite = reader.prepare('SELECT count(*) AS n FROM reviews').get() as { n: number };
    expect(duringWrite.n).toBe(1);

    writer.exec('COMMIT');

    const afterCommit = reader.prepare('SELECT count(*) AS n FROM reviews').get() as { n: number };
    expect(afterCommit.n).toBe(2);
  });
});

describe('supersede flow', () => {
  it('returns only the superseding finding from v_current_findings', () => {
    const sqlite = migratedConnection();
    insertReview(sqlite, 'rev-1', 'slug-1');
    insertFinding(sqlite, 'REV-STAT-0001', 'rev-1', null);
    insertFinding(sqlite, 'REV-STAT-0002', 'rev-1', 'REV-STAT-0001');

    const current = sqlite.prepare('SELECT id FROM v_current_findings ORDER BY id').all() as Array<{ id: string }>;
    expect(current.map((row) => row.id)).toEqual(['REV-STAT-0002']);
  });
});
