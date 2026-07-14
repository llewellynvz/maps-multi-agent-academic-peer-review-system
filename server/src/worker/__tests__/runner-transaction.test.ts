import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type MaraClient } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import * as repo from '../../workflow/repo';
import { WorkerRunner, type WorkerProcessors } from '../runner';

vi.mock('../../workflow/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../workflow/repo')>();
  return {
    ...actual,
    insertEvent: vi.fn(actual.insertEvent),
    updateReview: vi.fn(actual.updateReview),
  };
});

let tempDir: string;
let client: MaraClient;

const processors: WorkerProcessors = {
  startIngest: async () => 'ingested',
  resumeIngest: async () => 'ingested',
  runEngine: async () => 'completed',
};

function insertReview(id: string, createdAt: string): void {
  client.sqlite
    .prepare('INSERT INTO reviews (id, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, id, 'created', createdAt, createdAt);
}

function insertRunCommand(reviewId: string, command: string): string {
  const id = randomUUID();
  client.sqlite
    .prepare('INSERT INTO run_commands (id, review_id, command, args_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, reviewId, command, '{}', new Date().toISOString());
  return id;
}

function runCommandCount(reviewId: string): number {
  return (
    client.sqlite.prepare('SELECT count(*) AS n FROM run_commands WHERE review_id = ?').get(reviewId) as { n: number }
  ).n;
}

function insertControlAck(reviewId: string, commandId: string): void {
  client.sqlite
    .prepare(
      "INSERT INTO review_events (id, review_id, seq, ts, kind, payload_json) VALUES (?, ?, 1, ?, 'control_ack', ?)",
    )
    .run(randomUUID(), reviewId, new Date().toISOString(), JSON.stringify({ commandId }));
}

function completeIngest(reviewId: string): void {
  client.sqlite
    .prepare(
      "INSERT INTO phase_checkpoints (id, review_id, phase, status, updated_at) VALUES (?, ?, 'phase_1', 'completed', ?)",
    )
    .run(randomUUID(), reviewId, new Date().toISOString());
}

function reviewStatus(id: string): string {
  return (client.sqlite.prepare('SELECT status FROM reviews WHERE id = ?').get(id) as { status: string }).status;
}

function controlAckCount(reviewId: string): number {
  return (
    client.sqlite
      .prepare("SELECT count(*) AS n FROM review_events WHERE review_id = ? AND kind = 'control_ack'")
      .get(reviewId) as { n: number }
  ).n;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-tx-'));
  client = createDb(join(tempDir, 'mara.db'));
  runMigrations(client.db);
});

afterEach(() => {
  vi.mocked(repo.insertEvent).mockClear();
  vi.mocked(repo.updateReview).mockClear();
  client.sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('WorkerRunner apply-then-ack transactional coupling', () => {
  it('rolls back the queued transition when the ack insert fails, and stays retryable', () => {
    insertReview('rev-x', '2026-07-14T00:00:00.000Z');
    completeIngest('rev-x');
    insertRunCommand('rev-x', 'run');
    vi.mocked(repo.insertEvent).mockImplementationOnce(() => {
      throw new Error('ack insert boom');
    });

    const runner = new WorkerRunner({ client, processors });
    runner.pollCommands();

    expect(reviewStatus('rev-x')).toBe('created');
    expect(controlAckCount('rev-x')).toBe(0);

    runner.pollCommands();
    expect(reviewStatus('rev-x')).toBe('queued');
    expect(controlAckCount('rev-x')).toBe(1);
  });

  it('rolls back the ack when the status transition fails, and stays retryable', () => {
    insertReview('rev-y', '2026-07-14T00:00:00.000Z');
    completeIngest('rev-y');
    insertRunCommand('rev-y', 'run');
    vi.mocked(repo.updateReview).mockImplementationOnce(() => {
      throw new Error('status update boom');
    });

    const runner = new WorkerRunner({ client, processors });
    runner.pollCommands();

    expect(controlAckCount('rev-y')).toBe(0);
    expect(reviewStatus('rev-y')).toBe('created');

    runner.pollCommands();
    expect(reviewStatus('rev-y')).toBe('queued');
    expect(controlAckCount('rev-y')).toBe(1);
  });
});

describe('WorkerRunner command-row garbage collection (F8)', () => {
  it('deletes the run_commands row after a successful apply and ack', () => {
    insertReview('rev-gc', '2026-07-14T00:00:00.000Z');
    completeIngest('rev-gc');
    insertRunCommand('rev-gc', 'run');

    const runner = new WorkerRunner({ client, processors });
    runner.pollCommands();

    expect(reviewStatus('rev-gc')).toBe('queued');
    expect(controlAckCount('rev-gc')).toBe(1);
    expect(runCommandCount('rev-gc')).toBe(0);
  });

  it('does not re-apply a legacy acked command that predates row deletion', () => {
    insertReview('rev-legacy', '2026-07-14T00:00:00.000Z');
    completeIngest('rev-legacy');
    const commandId = insertRunCommand('rev-legacy', 'run');
    insertControlAck('rev-legacy', commandId);

    const runner = new WorkerRunner({ client, processors });
    runner.pollCommands();

    expect(reviewStatus('rev-legacy')).toBe('created');
    expect(controlAckCount('rev-legacy')).toBe(1);
    expect(runCommandCount('rev-legacy')).toBe(1);
  });
});
