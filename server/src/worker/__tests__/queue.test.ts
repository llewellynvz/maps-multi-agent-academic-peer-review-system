import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MaraClient } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { updateReview } from '../../workflow/repo';
import { WorkerRunner, type EngineResult, type WorkerProcessors } from '../runner';

let tempDir: string;
let client: MaraClient;

function insertReview(id: string, createdAt: string): void {
  client.sqlite
    .prepare('INSERT INTO reviews (id, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, id, 'created', createdAt, createdAt);
}

function insertRunCommand(reviewId: string, command: string, args: Record<string, unknown> = {}): void {
  client.sqlite
    .prepare('INSERT INTO run_commands (id, review_id, command, args_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), reviewId, command, JSON.stringify(args), new Date().toISOString());
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

interface Gate {
  promise: Promise<EngineResult>;
  release: () => void;
}

function makeGate(reviewId: string): Gate {
  let release!: () => void;
  const promise = new Promise<EngineResult>((resolve) => {
    release = () => {
      updateReview(client.db, reviewId, { status: 'completed' });
      resolve('completed');
    };
  });
  return { promise, release };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-queue-'));
  client = createDb(join(tempDir, 'mara.db'));
  runMigrations(client.db);
});

afterEach(() => {
  client.sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('WorkerRunner single-slot queue (NFR-06)', () => {
  it('runs one review at a time and dequeues the oldest queued review next', async () => {
    insertReview('rev-A', '2026-07-14T00:00:00.000Z');
    insertReview('rev-B', '2026-07-14T00:00:01.000Z');
    completeIngest('rev-A');
    completeIngest('rev-B');
    insertRunCommand('rev-A', 'run');
    insertRunCommand('rev-B', 'run');

    const gates = new Map<string, Gate>();
    const engineOrder: string[] = [];
    const processors: WorkerProcessors = {
      startIngest: async () => 'ingested',
      resumeIngest: async () => 'ingested',
      runEngine: async (reviewId) => {
        engineOrder.push(reviewId);
        const gate = makeGate(reviewId);
        gates.set(reviewId, gate);
        return gate.promise;
      },
    };

    const runner = new WorkerRunner({ client, processors });

    await runner.tick();
    expect(runner.active).toBe('rev-A');

    await runner.tick();
    expect(reviewStatus('rev-B')).toBe('queued');
    expect(engineOrder).toEqual(['rev-A']);

    gates.get('rev-A')?.release();
    await runner.settle();
    expect(reviewStatus('rev-A')).toBe('completed');
    expect(runner.idle).toBe(true);

    await runner.tick();
    expect(runner.active).toBe('rev-B');
    expect(engineOrder).toEqual(['rev-A', 'rev-B']);

    gates.get('rev-B')?.release();
    await runner.settle();
    expect(reviewStatus('rev-B')).toBe('completed');

    const terminals = client.sqlite
      .prepare("SELECT count(*) AS n FROM review_events WHERE kind = 'run_terminal'")
      .get() as { n: number };
    expect(terminals.n).toBe(2);
  });

  it('suspends at the clarifying gate and frees the slot for a queued review', async () => {
    insertReview('rev-A', '2026-07-14T00:00:00.000Z');
    insertReview('rev-B', '2026-07-14T00:00:01.000Z');
    insertRunCommand('rev-A', 'run', { trigger: 'ingest' });
    insertRunCommand('rev-B', 'run', { trigger: 'ingest' });
    completeIngest('rev-B');

    const processors: WorkerProcessors = {
      startIngest: async (reviewId) => {
        if (reviewId === 'rev-A') {
          updateReview(client.db, reviewId, { status: 'awaiting_input' });
          return 'suspended';
        }
        return 'ingested';
      },
      resumeIngest: async () => 'ingested',
      runEngine: async (reviewId) => {
        updateReview(client.db, reviewId, { status: 'completed' });
        return 'completed';
      },
    };

    const runner = new WorkerRunner({ client, processors });
    await runner.runOnce();
    expect(reviewStatus('rev-A')).toBe('awaiting_input');
    expect(runner.idle).toBe(true);

    await runner.runOnce();
    expect(reviewStatus('rev-B')).toBe('completed');
  });
});
