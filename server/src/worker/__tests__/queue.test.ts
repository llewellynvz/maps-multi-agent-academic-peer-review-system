import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MaraClient } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { artefactExists, writeArtefact } from '../../engine/artefacts';
import { blobDir } from '../../paths';
import { submitRunControl } from '../../data/commands';
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
  it('drops a picked-up review whose row was purged instead of processing a ghost', async () => {
    insertReview('rev-gone', '2026-07-14T00:00:00.000Z');
    client.sqlite.prepare("DELETE FROM reviews WHERE id = 'rev-gone'").run();

    let touched = 0;
    const processors: WorkerProcessors = {
      startIngest: async () => {
        touched += 1;
        return 'ingested';
      },
      resumeIngest: async () => {
        touched += 1;
        return 'ingested';
      },
      runEngine: async () => {
        touched += 1;
        return 'completed';
      },
    };
    const runner = new WorkerRunner({ client, processors });

    await expect(runner.processReview('rev-gone')).resolves.toBeUndefined();
    expect(touched).toBe(0);
  });

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

describe('retry_phase recovery semantics', () => {
  function failReview(id: string, errorClass: string): void {
    client.sqlite
      .prepare("UPDATE reviews SET status = 'failed', error_class = ?, current_phase = 'phase_8' WHERE id = ?")
      .run(errorClass, id);
    for (const phase of ['engine_phase_7', 'engine_phase_8']) {
      client.sqlite
        .prepare("INSERT INTO phase_checkpoints (id, review_id, phase, status, updated_at) VALUES (?, ?, ?, 'completed', ?)")
        .run(randomUUID(), id, phase, new Date().toISOString());
    }
  }

  function insertFinding(reviewId: string, findingId: string, supersedesId: string | null): void {
    client.sqlite
      .prepare(
        `INSERT INTO findings (id, review_id, agent, phase, type, claim, manuscript_anchor, epistemic_status,
         confidence, confidence_band, severity, fixability, scope, supersedes_id, created_at)
         VALUES (?, ?, 'specialist-reviewer', 'phase_7', 'statistical', 'A concern.', 'Table 1', 'Known',
         0.9, 'Yellow', 'major', 'moderate', 'author_facing', ?, ?)`,
      )
      .run(findingId, reviewId, supersedesId, new Date().toISOString());
  }

  function checkpointStatus(id: string, phase: string): string | undefined {
    const row = client.sqlite
      .prepare('SELECT status FROM phase_checkpoints WHERE review_id = ? AND phase = ?')
      .get(id, phase) as { status: string } | undefined;
    return row?.status;
  }

  it('invalidates all gate cycle artefacts and downstream phases on a gate-block retry', async () => {
    const id = `retry-${randomUUID()}`;
    insertReview(id, '2026-07-14T00:00:00.000Z');
    completeIngest(id);
    failReview(id, 'release_gate_block');
    writeArtefact(id, 'p6-report', { keep: true });
    writeArtefact(id, 'p7-shipped-0', { stale: true });
    writeArtefact(id, 'p7-critic-1', { stale: true });
    writeArtefact(id, 'p8-quality-metrics', { stale: true });
    writeArtefact(id, 'merge-p7-respecialist-STAT', { legacy: true, mergedIds: ['REV-STAT-0002'] });
    writeArtefact(id, 'merge-p3-STAT-first', { keep: true, mergedIds: ['REV-STAT-0001'] });
    insertFinding(id, 'REV-STAT-0001', null);
    insertFinding(id, 'REV-STAT-0002', 'REV-STAT-0001');
    insertFinding(id, 'REV-MEAS-0001', null);
    insertFinding(id, 'REV-CAUS-0001', null);
    insertFinding(id, 'REV-CAUS-0002', 'REV-CAUS-0001');
    client.sqlite
      .prepare('INSERT INTO merge_markers (id, review_id, marker, merged_ids_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), id, 'p7-respecialist-MEAS', JSON.stringify(['REV-MEAS-0001']), new Date().toISOString());
    client.sqlite
      .prepare('INSERT INTO merge_markers (id, review_id, marker, merged_ids_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), id, 'p7-respecialist-CAUS', JSON.stringify(['REV-CAUS-0001', 'REV-CAUS-0002']), new Date().toISOString());
    client.sqlite
      .prepare('INSERT INTO merge_markers (id, review_id, marker, created_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), id, 'p3-STAT-first', new Date().toISOString());
    insertRunCommand(id, 'retry_phase', { phase: 'phase_7' });

    const engineOrder: string[] = [];
    const runner = new WorkerRunner({ client, processors: countingProcessors(engineOrder) });
    await runner.runOnce();

    expect(artefactExists(id, 'p6-report')).toBe(true);
    expect(artefactExists(id, 'p7-shipped-0')).toBe(false);
    expect(artefactExists(id, 'p7-critic-1')).toBe(false);
    expect(artefactExists(id, 'p8-quality-metrics')).toBe(false);
    expect(artefactExists(id, 'merge-p7-respecialist-STAT')).toBe(false);
    expect(artefactExists(id, 'merge-p3-STAT-first')).toBe(true);
    const markers = client.sqlite
      .prepare('SELECT marker FROM merge_markers WHERE review_id = ? ORDER BY marker')
      .all(id) as Array<{ marker: string }>;
    expect(markers.map((row) => row.marker)).toEqual(['p3-STAT-first']);
    const remainingFindings = client.sqlite
      .prepare('SELECT id FROM findings WHERE review_id = ? ORDER BY id')
      .all(id) as Array<{ id: string }>;
    expect(remainingFindings.map((row) => row.id)).toEqual(['REV-STAT-0001']);
    expect(checkpointStatus(id, 'engine_phase_7')).toBe('pending');
    expect(checkpointStatus(id, 'engine_phase_8')).toBe('pending');
    const errorClass = (client.sqlite.prepare('SELECT error_class FROM reviews WHERE id = ?').get(id) as { error_class: string | null }).error_class;
    expect(errorClass).toBeNull();
    expect(engineOrder).toEqual([id]);
    expect(reviewStatus(id)).toBe('completed');
    rmSync(blobDir(id), { recursive: true, force: true });
  });

  it('keeps cached artefacts on a transient engine_error retry so successes are not re-paid', async () => {
    const id = `retry-${randomUUID()}`;
    insertReview(id, '2026-07-14T00:00:00.000Z');
    completeIngest(id);
    failReview(id, 'engine_error');
    writeArtefact(id, 'p7-shipped-0', { cached: true });
    insertRunCommand(id, 'retry_phase', { phase: 'phase_7' });

    const engineOrder: string[] = [];
    const runner = new WorkerRunner({ client, processors: countingProcessors(engineOrder) });
    await runner.runOnce();

    expect(artefactExists(id, 'p7-shipped-0')).toBe(true);
    expect(checkpointStatus(id, 'engine_phase_7')).toBe('pending');
    expect(checkpointStatus(id, 'engine_phase_8')).toBe('completed');
    expect(engineOrder).toEqual([id]);
    rmSync(blobDir(id), { recursive: true, force: true });
  });

  // A retry once lived only in worker memory: a restart between the destructive purge and the
  // re-run silently lost it, leaving a wiped review parked on failed.
  it('survives a worker crash between accepting the retry and running it', async () => {
    const id = `retry-${randomUUID()}`;
    insertReview(id, '2026-07-14T00:00:00.000Z');
    completeIngest(id);
    failReview(id, 'release_gate_block');
    insertRunCommand(id, 'retry_phase', { phase: 'phase_7' });

    const crashed = new WorkerRunner({ client, processors: countingProcessors([]) });
    crashed.pollCommands();
    expect(reviewStatus(id)).toBe('queued');

    const engineOrder: string[] = [];
    const survivor = new WorkerRunner({ client, processors: countingProcessors(engineOrder) });
    await survivor.runOnce();
    expect(engineOrder).toEqual([id]);
    expect(reviewStatus(id)).toBe('completed');
    rmSync(blobDir(id), { recursive: true, force: true });
  });

  // A phase_8-targeted retry after a phase_7 halt left engine_phase_7 completed, so phaseDone
  // short-circuited and the pipeline failed not_released five times with zero dispatches.
  it('clamps a downstream retry target back to the unreleased gate phase', async () => {
    const id = `retry-${randomUUID()}`;
    insertReview(id, '2026-07-14T00:00:00.000Z');
    completeIngest(id);
    failReview(id, 'release_gate_block');
    client.sqlite
      .prepare('UPDATE phase_checkpoints SET snapshot_json = ? WHERE review_id = ? AND phase = ?')
      .run(JSON.stringify({ released: false, blocked: true, reason: 'gate block' }), id, 'engine_phase_7');
    writeArtefact(id, 'p7-shipped-0', { stale: true });
    insertRunCommand(id, 'retry_phase', { phase: 'phase_8' });

    const runner = new WorkerRunner({ client, processors: countingProcessors([]) });
    await runner.runOnce();

    expect(checkpointStatus(id, 'engine_phase_7')).toBe('pending');
    expect(artefactExists(id, 'p7-shipped-0')).toBe(false);
    const retryEvent = client.sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'phase_transition' AND json_extract(payload_json, '$.retry') = 1")
      .get(id) as { payload_json: string };
    expect(JSON.parse(retryEvent.payload_json).invalidatedFrom).toBe(7);
    rmSync(blobDir(id), { recursive: true, force: true });
  });

  it('clears the stale gate snapshot when a retry regenerates the phases beneath it', async () => {
    const id = `retry-${randomUUID()}`;
    insertReview(id, '2026-07-14T00:00:00.000Z');
    completeIngest(id);
    failReview(id, 'release_gate_block');
    client.sqlite
      .prepare('UPDATE phase_checkpoints SET snapshot_json = ? WHERE review_id = ? AND phase = ?')
      .run(JSON.stringify({ released: false, blocked: true, reason: 'a draft that will no longer exist' }), id, 'engine_phase_7');
    insertRunCommand(id, 'retry_phase', { phase: 'phase_5' });

    const runner = new WorkerRunner({ client, processors: countingProcessors([]) });
    await runner.runOnce();

    const snapshot = (client.sqlite
      .prepare('SELECT snapshot_json FROM phase_checkpoints WHERE review_id = ? AND phase = ?')
      .get(id, 'engine_phase_7') as { snapshot_json: string | null }).snapshot_json;
    expect(snapshot).toBeNull();
    rmSync(blobDir(id), { recursive: true, force: true });
  });

  it('discards a retry whose transaction cannot apply, once, instead of re-polling it forever', async () => {
    const id = `retry-${randomUUID()}`;
    insertReview(id, '2026-07-14T00:00:00.000Z');
    completeIngest(id);
    failReview(id, 'release_gate_block');
    client.sqlite
      .prepare('INSERT INTO merge_markers (id, review_id, marker, merged_ids_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), id, 'p7-corrupt', 'not json at all', new Date().toISOString());
    insertRunCommand(id, 'retry_phase', { phase: 'phase_7' });

    const engineOrder: string[] = [];
    const runner = new WorkerRunner({ client, processors: countingProcessors(engineOrder) });
    await runner.runOnce();
    await runner.runOnce();

    const remaining = (client.sqlite.prepare('SELECT COUNT(*) AS n FROM run_commands').get() as { n: number }).n;
    expect(remaining).toBe(0);
    expect(engineOrder).toEqual([]);
    expect(reviewStatus(id)).toBe('failed');
    const errorEvents = (client.sqlite
      .prepare("SELECT COUNT(*) AS n FROM review_events WHERE review_id = ? AND kind = 'error'")
      .get(id) as { n: number }).n;
    expect(errorEvents).toBe(1);
  });

  it('accepts one queued retry and noops the duplicates', () => {
    const id = `retry-${randomUUID()}`;
    insertReview(id, '2026-07-14T00:00:00.000Z');
    completeIngest(id);
    failReview(id, 'release_gate_block');
    const first = submitRunControl(client.db, id, 'retry_phase', { phase: 'phase_7' });
    const second = submitRunControl(client.db, id, 'retry_phase', { phase: 'phase_7' });
    expect(first.noop).toBeUndefined();
    expect(second.noop).toBe(true);
    const pending = (client.sqlite.prepare('SELECT COUNT(*) AS n FROM run_commands').get() as { n: number }).n;
    expect(pending).toBe(1);
  });

  // A crash mid-retried-run leaves the checkpoint pending while the review is failed; the manual
  // Retry button is the designated backstop and must not 422 in that state.
  it('accepts a manual retry of a pending phase when the review itself is failed', () => {
    const id = `retry-${randomUUID()}`;
    insertReview(id, '2026-07-14T00:00:00.000Z');
    completeIngest(id);
    failReview(id, 'release_gate_block');
    client.sqlite
      .prepare("UPDATE phase_checkpoints SET status = 'pending' WHERE review_id = ? AND phase = 'engine_phase_7'")
      .run(id);
    const result = submitRunControl(client.db, id, 'retry_phase', { phase: 'phase_7' });
    expect(result.accepted).toBe(true);
    expect(result.noop).toBeUndefined();
  });

  it('retries a gate block in the background twice, then parks the review for a manual retry', async () => {
    const id = `retry-${randomUUID()}`;
    insertReview(id, '2026-07-14T00:00:00.000Z');
    completeIngest(id);
    failReview(id, 'release_gate_block');
    insertRunCommand(id, 'retry_phase', { phase: 'phase_7' });

    const blockingProcessors: WorkerProcessors = {
      startIngest: async () => 'ingested',
      resumeIngest: async () => 'ingested',
      runEngine: async (reviewId) => {
        client.sqlite
          .prepare("UPDATE reviews SET status = 'failed', error_class = 'release_gate_block', current_phase = 'phase_7' WHERE id = ?")
          .run(reviewId);
        client.sqlite
          .prepare("UPDATE phase_checkpoints SET status = 'completed', snapshot_json = ? WHERE review_id = ? AND phase = 'engine_phase_7'")
          .run(JSON.stringify({ released: false, blocked: true, reason: 'still blocked' }), reviewId);
        return 'completed';
      },
    };
    const runner = new WorkerRunner({ client, processors: blockingProcessors });
    for (let i = 0; i < 6; i += 1) {
      await runner.runOnce();
      await runner.settle();
    }

    const autoEvents = (client.sqlite
      .prepare("SELECT COUNT(*) AS n FROM review_events WHERE review_id = ? AND kind = 'phase_transition' AND json_extract(payload_json, '$.retry') = 1 AND json_extract(payload_json, '$.auto') = 1")
      .get(id) as { n: number }).n;
    expect(autoEvents).toBe(2);
    const firstAuto = client.sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'phase_transition' AND json_extract(payload_json, '$.auto') = 1 ORDER BY seq LIMIT 1")
      .get(id) as { payload_json: string };
    const payload = JSON.parse(firstAuto.payload_json) as { attempt: number; maxAttempts: number; reason: string };
    expect(payload.attempt).toBe(1);
    expect(payload.maxAttempts).toBe(2);
    expect(payload.reason).toContain('release gate blocked');
    expect(payload.reason).not.toContain('still blocked');
    expect(reviewStatus(id)).toBe('failed');
    const pending = (client.sqlite.prepare('SELECT COUNT(*) AS n FROM run_commands').get() as { n: number }).n;
    expect(pending).toBe(0);
    rmSync(blobDir(id), { recursive: true, force: true });
  });

  // A crash inside a phase leaves no checkpoint row for it, so the auto-retry must not depend on
  // the manual path's checkpoint validation.
  it('auto-retries an engine crash that left no checkpoint for the failed phase', async () => {
    const id = `retry-${randomUUID()}`;
    insertReview(id, '2026-07-14T00:00:00.000Z');
    completeIngest(id);
    insertRunCommand(id, 'run');

    const crashing: WorkerProcessors = {
      startIngest: async () => 'ingested',
      resumeIngest: async () => 'ingested',
      runEngine: async (reviewId) => {
        client.sqlite
          .prepare("UPDATE reviews SET status = 'failed', error_class = 'engine_error', current_phase = 'phase_3' WHERE id = ?")
          .run(reviewId);
        return 'failed';
      },
    };
    const runner = new WorkerRunner({ client, processors: crashing });
    await runner.runOnce();
    await runner.settle();

    const queuedRetry = client.sqlite
      .prepare("SELECT args_json FROM run_commands WHERE review_id = ? AND command = 'retry_phase'")
      .get(id) as { args_json: string } | undefined;
    expect(queuedRetry).toBeDefined();
    expect(JSON.parse(queuedRetry!.args_json)).toEqual({ phase: 'phase_3', auto: true });
    rmSync(blobDir(id), { recursive: true, force: true });
  });
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
