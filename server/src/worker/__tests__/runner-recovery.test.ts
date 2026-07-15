import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MaraClient } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { insertEvent, recordEngineFailure, updateReview } from '../../workflow/repo';
import { WorkerRunner, type WorkerProcessors } from '../runner';
import type { StopSignal } from '../supervisor';

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

function ackCount(): number {
  return (
    client.sqlite.prepare("SELECT count(*) AS n FROM review_events WHERE kind = 'control_ack'").get() as { n: number }
  ).n;
}

function completingProcessors(order: string[]): WorkerProcessors {
  return {
    startIngest: async () => 'ingested',
    resumeIngest: async () => 'ingested',
    runEngine: async (reviewId) => {
      order.push(reviewId);
      updateReview(client.db, reviewId, { status: 'completed' });
      return 'completed';
    },
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-recovery-'));
  client = createDb(join(tempDir, 'mara.db'));
  runMigrations(client.db);
});

afterEach(() => {
  client.sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function insertManuscript(reviewId: string, mimeType: string, filename: string, blobPath: string): void {
  client.sqlite
    .prepare(
      'INSERT INTO manuscripts (id, review_id, original_filename, mime_type, blob_path, byte_size, sha256, ingested_at) VALUES (?, ?, ?, ?, ?, 10, ?, ?)',
    )
    .run(randomUUID(), reviewId, filename, mimeType, blobPath, 'a'.repeat(64), new Date().toISOString());
}

function leaseHeartbeat(): string {
  const row = client.sqlite.prepare("SELECT value_json FROM settings WHERE key = 'worker_lease'").get() as
    | { value_json: string }
    | undefined;
  return row !== undefined ? (JSON.parse(row.value_json) as { heartbeatAt: string }).heartbeatAt : '';
}

function leaseWorker(): string {
  const row = client.sqlite.prepare("SELECT value_json FROM settings WHERE key = 'worker_lease'").get() as
    | { value_json: string }
    | undefined;
  return row !== undefined ? (JSON.parse(row.value_json) as { workerId: string }).workerId : '';
}

function seedForeignLease(workerId: string, heartbeatAt: string): void {
  client.sqlite
    .prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)')
    .run('worker_lease', JSON.stringify({ workerId, heartbeatAt }), new Date().toISOString());
}

describe('self-describing failures and retry terminals (S0b, S0d)', () => {
  it('records a self-describing run_terminal with the error type and the failing phase', () => {
    const id = 'rev-selfdescribe';
    insertReview(id, new Date().toISOString());
    updateReview(client.db, id, { currentPhase: 'phase_3' });
    recordEngineFailure(client.db, id, 'TypeError');
    const term = client.sqlite
      .prepare("SELECT phase, payload_json FROM review_events WHERE review_id = ? AND kind = 'run_terminal' ORDER BY seq DESC LIMIT 1")
      .get(id) as { phase: string; payload_json: string };
    expect(term.phase).toBe('phase_3');
    const payload = JSON.parse(term.payload_json) as { errorClass: string; reason: string; phase: string };
    expect(payload.errorClass).toBe('engine_error');
    expect(payload.reason).toContain('TypeError');
    expect(payload.reason).toContain('phase_3');
    expect(payload.phase).toBe('phase_3');
    expect(reviewStatus(id)).toBe('failed');
  });

  it('never lets a raw exception message reach the streamed terminal (confidentiality)', () => {
    const id = 'rev-leakguard';
    insertReview(id, new Date().toISOString());
    updateReview(client.db, id, { currentPhase: 'phase_2' });
    recordEngineFailure(client.db, id, 'schema validation failed: received "the abstract text of the manuscript"');
    const term = client.sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'run_terminal' ORDER BY seq DESC LIMIT 1")
      .get(id) as { payload_json: string };
    expect(term.payload_json).not.toContain('abstract text of the manuscript');
    expect((JSON.parse(term.payload_json) as { reason: string }).reason).toContain('Error');
  });

  it('does not duplicate the terminal within one run but appends a fresh one after a retry', () => {
    const id = 'rev-retry-terminal';
    insertReview(id, new Date().toISOString());
    updateReview(client.db, id, { currentPhase: 'phase_7' });
    recordEngineFailure(client.db, id, 'FirstError');
    recordEngineFailure(client.db, id, 'DuplicateWithinTheSameRun');
    let terms = client.sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'run_terminal' ORDER BY seq")
      .all(id) as { payload_json: string }[];
    expect(terms.length).toBe(1);

    insertEvent(client.db, { reviewId: id, kind: 'gate_verdict', phase: 'phase_7', payload: { cycle: 0 } });
    recordEngineFailure(client.db, id, 'SecondErrorAfterRetry');
    terms = client.sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'run_terminal' ORDER BY seq")
      .all(id) as { payload_json: string }[];
    expect(terms.length).toBe(2);
    expect((JSON.parse(terms[1]!.payload_json) as { reason: string }).reason).toContain('SecondErrorAfterRetry');
  });
});

describe('WorkerRunner lease heartbeat throttling (F10)', () => {
  it('refreshes the held lease only after it ages past a third of the stale window', async () => {
    let clock = Date.UTC(2026, 6, 14);
    const runner = new WorkerRunner({
      client,
      processors: completingProcessors([]),
      now: () => clock,
      staleLeaseMs: 60_000,
      workerId: 'w1',
    });

    await runner.tick();
    const hb1 = leaseHeartbeat();
    expect(hb1).not.toBe('');

    clock += 10_000;
    await runner.tick();
    expect(leaseHeartbeat()).toBe(hb1);

    clock += 15_000;
    await runner.tick();
    expect(leaseHeartbeat()).not.toBe(hb1);
  });

  it('takes over a stale foreign lease immediately', async () => {
    const base = Date.UTC(2026, 6, 14);
    seedForeignLease('other', new Date(base).toISOString());
    let clock = base + 61_000;
    const runner = new WorkerRunner({
      client,
      processors: completingProcessors([]),
      now: () => clock,
      staleLeaseMs: 60_000,
      workerId: 'w1',
    });

    await runner.tick();
    expect(leaseWorker()).toBe('w1');
  });
});

describe('WorkerRunner ingest resume reconciliation (F11)', () => {
  it('falls back to a fresh ingest when the stored ingest snapshot is missing', async () => {
    insertReview('rev-missing', '2026-07-14T00:00:00.000Z');
    insertManuscript('rev-missing', 'application/pdf', 'study.pdf', 'data/blobs/rev-missing/manuscript/original.pdf');
    client.sqlite.prepare("UPDATE reviews SET status = 'awaiting_input' WHERE id = 'rev-missing'").run();
    insertRunCommand('rev-missing', 'resume', { answers: { field: 'wellbeing' } });

    const calls = { start: 0, resume: 0 };
    const seenArgs: Array<Record<string, unknown>> = [];
    const processors: WorkerProcessors = {
      startIngest: async (_reviewId, args) => {
        calls.start += 1;
        seenArgs.push(args);
        updateReview(client.db, 'rev-missing', { status: 'awaiting_input' });
        return 'suspended';
      },
      resumeIngest: async () => {
        calls.resume += 1;
        return 'ingested';
      },
      runEngine: async () => 'completed',
      ingestResumable: async () => false,
    };

    const runner = new WorkerRunner({ client, processors });
    runner.pollCommands();
    await runner.runOnce();
    await runner.settle();

    expect(calls.resume).toBe(0);
    expect(calls.start).toBe(1);
    expect(seenArgs[0]?.filePath).toBe('data/blobs/rev-missing/manuscript/original.pdf');
    const fallbackEvents = client.sqlite
      .prepare("SELECT count(*) AS n FROM review_events WHERE review_id = 'rev-missing' AND kind = 'error'")
      .get() as { n: number };
    expect(fallbackEvents.n).toBe(1);
  });
});

describe('WorkerRunner durable apply-then-ack recovery', () => {
  it('resumes a queued review from the db alone after an apply+ack crash', async () => {
    insertReview('rev-crash', '2026-07-14T00:00:00.000Z');
    completeIngest('rev-crash');
    insertRunCommand('rev-crash', 'run');

    const orderA: string[] = [];
    const runnerA = new WorkerRunner({ client, processors: completingProcessors(orderA) });
    runnerA.pollCommands();
    expect(reviewStatus('rev-crash')).toBe('queued');
    expect(orderA).toEqual([]);
    expect(ackCount()).toBe(1);

    const orderB: string[] = [];
    const runnerB = new WorkerRunner({ client, processors: completingProcessors(orderB) });
    await runnerB.runOnce();
    await runnerB.settle();

    expect(orderB).toEqual(['rev-crash']);
    expect(reviewStatus('rev-crash')).toBe('completed');
    expect(ackCount()).toBe(1);
  });

  it('refuses to consume under a fresh peer lease, then takes over when it goes stale', async () => {
    insertReview('rev-z', '2026-07-14T00:00:00.000Z');
    completeIngest('rev-z');

    let clock = Date.UTC(2026, 6, 14);
    const now = (): number => clock;
    const orderA: string[] = [];
    const orderB: string[] = [];
    const runnerA = new WorkerRunner({
      client,
      processors: completingProcessors(orderA),
      now,
      staleLeaseMs: 60_000,
      workerId: 'worker-A',
    });
    const runnerB = new WorkerRunner({
      client,
      processors: completingProcessors(orderB),
      now,
      staleLeaseMs: 60_000,
      workerId: 'worker-B',
    });

    await runnerA.runOnce();
    insertRunCommand('rev-z', 'run');

    await runnerB.runOnce();
    expect(orderB).toEqual([]);
    expect(reviewStatus('rev-z')).toBe('created');
    expect(ackCount()).toBe(0);

    clock += 61_000;
    await runnerB.runOnce();
    await runnerB.settle();

    expect(orderB).toEqual(['rev-z']);
    expect(reviewStatus('rev-z')).toBe('completed');
  });

  it('recovers a docx review with the manuscript row args, not pdf defaults', async () => {
    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    insertReview('rev-docx', '2026-07-14T00:00:00.000Z');
    insertManuscript('rev-docx', docxMime, 'study.docx', 'data/blobs/rev-docx/manuscript/original.docx');
    client.sqlite.prepare("UPDATE reviews SET status = 'queued' WHERE id = 'rev-docx'").run();

    const seenArgs: Array<Record<string, unknown>> = [];
    const processors: WorkerProcessors = {
      startIngest: async (_reviewId, args) => {
        seenArgs.push(args);
        updateReview(client.db, 'rev-docx', { status: 'awaiting_input' });
        return 'suspended';
      },
      resumeIngest: async () => 'ingested',
      runEngine: async () => 'completed',
    };
    const runner = new WorkerRunner({ client, processors });
    await runner.runOnce();
    await runner.settle();

    expect(seenArgs).toHaveLength(1);
    expect(seenArgs[0]?.mimeType).toBe(docxMime);
    expect(seenArgs[0]?.originalFilename).toBe('study.docx');
    expect(seenArgs[0]?.filePath).toBe('data/blobs/rev-docx/manuscript/original.docx');
  });

  it('stops the engine at the next phase boundary when another worker takes the lease', async () => {
    insertReview('rev-fence', '2026-07-14T00:00:00.000Z');
    completeIngest('rev-fence');

    let clock = Date.UTC(2026, 6, 14);
    const now = (): number => clock;
    const stops: Array<() => StopSignal> = [];
    let releaseEngine!: () => void;
    const engineGate = new Promise<'stopped'>((resolve) => {
      releaseEngine = () => resolve('stopped');
    });
    const processorsA: WorkerProcessors = {
      startIngest: async () => 'ingested',
      resumeIngest: async () => 'ingested',
      runEngine: async (_reviewId, shouldStop) => {
        stops.push(shouldStop);
        return engineGate;
      },
    };
    const orderB: string[] = [];
    const runnerA = new WorkerRunner({ client, processors: processorsA, now, staleLeaseMs: 60_000, workerId: 'worker-A' });
    const runnerB = new WorkerRunner({ client, processors: completingProcessors(orderB), now, staleLeaseMs: 60_000, workerId: 'worker-B' });

    insertRunCommand('rev-fence', 'run');
    await runnerA.tick();
    expect(runnerA.active).toBe('rev-fence');
    expect(stops).toHaveLength(1);
    expect(stops[0]!()).toBeNull();

    clock += 61_000;
    await runnerB.runOnce();
    await runnerB.settle();
    expect(orderB).toEqual(['rev-fence']);
    expect(stops[0]!()).toBe('shutdown');

    releaseEngine();
    await runnerA.settle();
    expect(reviewStatus('rev-fence')).toBe('completed');
    const terminals = client.sqlite
      .prepare("SELECT count(*) AS n FROM review_events WHERE review_id = 'rev-fence' AND kind = 'run_terminal'")
      .get() as { n: number };
    expect(terminals.n).toBe(1);
  });

  it('does not stomp a takeover worker terminal status when its own engine errors', async () => {
    insertReview('rev-guard', '2026-07-14T00:00:00.000Z');
    completeIngest('rev-guard');

    let clock = Date.UTC(2026, 6, 14);
    const now = (): number => clock;
    let failEngine!: () => void;
    const engineGate = new Promise<never>((_, reject) => {
      failEngine = () => reject(new Error('woke up after suspension'));
    });
    const processorsA: WorkerProcessors = {
      startIngest: async () => 'ingested',
      resumeIngest: async () => 'ingested',
      runEngine: async () => engineGate,
    };
    const orderB: string[] = [];
    const runnerA = new WorkerRunner({ client, processors: processorsA, now, staleLeaseMs: 60_000, workerId: 'worker-A' });
    const runnerB = new WorkerRunner({ client, processors: completingProcessors(orderB), now, staleLeaseMs: 60_000, workerId: 'worker-B' });

    insertRunCommand('rev-guard', 'run');
    await runnerA.tick();
    expect(runnerA.active).toBe('rev-guard');

    clock += 61_000;
    await runnerB.runOnce();
    await runnerB.settle();
    expect(orderB).toEqual(['rev-guard']);
    expect(reviewStatus('rev-guard')).toBe('completed');

    failEngine();
    await runnerA.settle();
    expect(reviewStatus('rev-guard')).toBe('completed');
    const terminal = client.sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = 'rev-guard' AND kind = 'run_terminal'")
      .all() as Array<{ payload_json: string }>;
    expect(terminal).toHaveLength(1);
    expect((JSON.parse(terminal[0]!.payload_json) as { outcome: string }).outcome).toBe('complete');
  });
});
