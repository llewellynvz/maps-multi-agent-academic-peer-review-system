import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MaraClient } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { pauseReview, updateReview } from '../../workflow/repo';
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

  it('prioritises an explicit command over crash-recovered stale reviews', async () => {
    insertReview('rev-stale', '2026-07-13T00:00:00.000Z');
    client.sqlite.prepare("UPDATE reviews SET status = 'running' WHERE id = 'rev-stale'").run();
    insertReview('rev-fresh', '2026-07-14T00:00:00.000Z');
    completeIngest('rev-stale');
    completeIngest('rev-fresh');

    const engineOrder: string[] = [];
    const processors: WorkerProcessors = {
      startIngest: async () => 'ingested',
      resumeIngest: async () => 'ingested',
      runEngine: async (reviewId) => {
        engineOrder.push(reviewId);
        updateReview(client.db, reviewId, { status: 'completed' });
        return 'completed';
      },
    };

    const runner = new WorkerRunner({ client, processors });
    runner.recover();
    insertRunCommand('rev-fresh', 'run');

    await runner.runOnce();
    await runner.runOnce();
    expect(engineOrder).toEqual(['rev-fresh', 'rev-stale']);
  });

  it('marks a release-gate-blocked run failed without duplicating the engine terminal', async () => {
    insertReview('rev-blocked', '2026-07-14T00:00:00.000Z');
    completeIngest('rev-blocked');
    insertRunCommand('rev-blocked', 'run');

    const processors: WorkerProcessors = {
      startIngest: async () => 'ingested',
      resumeIngest: async () => 'ingested',
      runEngine: async (reviewId) => {
        updateReview(client.db, reviewId, { status: 'running', errorClass: 'release_gate_block' });
        client.sqlite
          .prepare(
            "INSERT INTO review_events (id, review_id, seq, ts, kind, phase, payload_json) VALUES (?, ?, 1, ?, 'run_terminal', 'phase_7', ?)",
          )
          .run(randomUUID(), reviewId, new Date().toISOString(), JSON.stringify({ released: false, reason: 'halt' }));
        return 'completed';
      },
    };

    const runner = new WorkerRunner({ client, processors });
    await runner.runOnce();

    expect(reviewStatus('rev-blocked')).toBe('failed');
    const terminals = client.sqlite
      .prepare("SELECT count(*) AS n FROM review_events WHERE review_id = 'rev-blocked' AND kind = 'run_terminal'")
      .get() as { n: number };
    expect(terminals.n).toBe(1);
  });
});

function setAwaitingInput(id: string, updatedAt: string): void {
  client.sqlite.prepare("UPDATE reviews SET status = 'awaiting_input', updated_at = ? WHERE id = ?").run(updatedAt, id);
}

function pauseReason(id: string): string | undefined {
  const row = client.sqlite.prepare('SELECT options_json FROM reviews WHERE id = ?').get(id) as { options_json: string };
  return (JSON.parse(row.options_json) as { pauseReason?: string }).pauseReason;
}

const countingProcessors = (engineOrder: string[]): WorkerProcessors => ({
  startIngest: async () => 'ingested',
  resumeIngest: async () => 'ingested',
  runEngine: async (reviewId) => {
    engineOrder.push(reviewId);
    updateReview(client.db, reviewId, { status: 'completed' });
    return 'completed';
  },
});

describe('PIPE-27 awaiting_input timeout', () => {
  const nowMs = Date.parse('2026-07-14T12:00:00.000Z');
  const timeoutMs = 30 * 60_000;

  it('pauses a review held in awaiting_input past the timeout, releases the slot, and starts no dispatch', async () => {
    insertReview('rev-A', '2026-07-14T00:00:00.000Z');
    setAwaitingInput('rev-A', '2026-07-14T11:00:00.000Z');
    insertReview('rev-B', '2026-07-14T00:00:01.000Z');
    completeIngest('rev-B');
    insertRunCommand('rev-B', 'run');

    const engineOrder: string[] = [];
    const runner = new WorkerRunner({ client, processors: countingProcessors(engineOrder), now: () => nowMs, awaitingInputTimeoutMs: timeoutMs });
    await runner.runOnce();

    expect(reviewStatus('rev-A')).toBe('paused');
    expect(pauseReason('rev-A')).toBe('awaiting_input_timeout');
    expect(engineOrder).toEqual(['rev-B']);
    expect(reviewStatus('rev-B')).toBe('completed');
  });

  it('leaves an awaiting_input review untouched before the timeout elapses', async () => {
    insertReview('rev-A', '2026-07-14T00:00:00.000Z');
    setAwaitingInput('rev-A', '2026-07-14T11:55:00.000Z');

    const engineOrder: string[] = [];
    const runner = new WorkerRunner({ client, processors: countingProcessors(engineOrder), now: () => nowMs, awaitingInputTimeoutMs: timeoutMs });
    await runner.runOnce();

    expect(reviewStatus('rev-A')).toBe('awaiting_input');
    expect(engineOrder).toEqual([]);
  });

  it('never times out a review whose resume command is already queued', () => {
    insertReview('rev-A', '2026-07-14T00:00:00.000Z');
    setAwaitingInput('rev-A', '2026-07-14T10:00:00.000Z');
    insertRunCommand('rev-A', 'resume');

    const runner = new WorkerRunner({ client, processors: countingProcessors([]), now: () => nowMs, awaitingInputTimeoutMs: timeoutMs });
    runner.scanAwaitingInputTimeouts();

    expect(reviewStatus('rev-A')).toBe('awaiting_input');
  });

  it('keeps resume available after an awaiting_input timeout pause', async () => {
    insertReview('rev-A', '2026-07-14T00:00:00.000Z');
    setAwaitingInput('rev-A', '2026-07-14T10:00:00.000Z');

    const engineOrder: string[] = [];
    const runner = new WorkerRunner({ client, processors: countingProcessors(engineOrder), now: () => nowMs, awaitingInputTimeoutMs: timeoutMs });
    await runner.runOnce();
    expect(reviewStatus('rev-A')).toBe('paused');

    insertRunCommand('rev-A', 'resume');
    await runner.runOnce();

    expect(reviewStatus('rev-A')).toBe('completed');
    expect(engineOrder).toEqual(['rev-A']);
  });
});

describe('PIPE-26 cost-ceiling pause at the worker', () => {
  it('requeues a cost_ceiling-paused review on a run command and hands it back to the engine', async () => {
    insertReview('rev-A', '2026-07-14T00:00:00.000Z');
    completeIngest('rev-A');
    pauseReview(client.db, 'rev-A', { reason: 'cost_ceiling', phase: 'phase_3' });
    expect(reviewStatus('rev-A')).toBe('paused');

    const engineOrder: string[] = [];
    const runner = new WorkerRunner({ client, processors: countingProcessors(engineOrder) });
    insertRunCommand('rev-A', 'run');
    await runner.runOnce();

    expect(reviewStatus('rev-A')).toBe('completed');
    expect(engineOrder).toEqual(['rev-A']);
  });
});
