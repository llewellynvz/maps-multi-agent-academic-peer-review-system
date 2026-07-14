import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MaraClient } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { blobDir } from '../../paths';
import type { DispatchInput, DispatchResult } from '../../providers';
import { getSettings, putSettings } from '../../data/settings';
import { writeSetting } from '../../data/settings-store';
import { getCheckpoint, getReviewOptions, mergeReviewOptions, pauseReview, upsertCheckpoint } from '../../workflow/repo';
import { runEnginePhases, type EnginePhaseStep } from '../../worker/supervisor';
import { createCostCeilingGate, DispatchPauseError, type EngineDeps, runAgent } from '../index';

let client: MaraClient;
let tempDir: string;
const reviewIds: string[] = [];

function reviewId(): string {
  const id = `test-cost-ceiling-${randomUUID()}`;
  reviewIds.push(id);
  return id;
}

function insertReview(id: string): void {
  const now = new Date().toISOString();
  client.sqlite.prepare('INSERT INTO reviews (id, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, id, 'created', now, now);
}

function insertDispatch(id: string, costUsd: number): void {
  client.sqlite
    .prepare(
      `INSERT INTO dispatches (id, review_id, phase, agent, provider, model, prompt_version, latency_ms, cost_usd, status, created_at)
       VALUES (?, ?, 'phase_3', 'specialist-reviewer', 'azure', 'test', 'v1', 1, ?, 'success', ?)`,
    )
    .run(randomUUID(), id, costUsd, new Date().toISOString());
}

function reviewStatus(id: string): string {
  return (client.sqlite.prepare('SELECT status FROM reviews WHERE id = ?').get(id) as { status: string }).status;
}

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'REV-METH-0001',
    lens: 'Methods and design',
    phase: 3,
    claim: 'The design cannot support causal claims.',
    anchor: 'Analysis (lines 38-39)',
    epistemic: 'Known',
    confidence: 0.95,
    band: 'Yellow',
    severity: 'major',
    fixability: 'moderate',
    scope: 'author-facing',
    failureScenario: 'Readers over-interpret the mediation model.',
    leanestFix: 'Reframe as associations.',
    supersedes: null,
    ...overrides,
  };
}

function successResult(): DispatchResult {
  return {
    dispatchId: 'd1',
    provider: 'azure',
    model: 'test',
    status: 'success',
    object: { lens: 'Methods and design', coreContributionReading: 'A cross-sectional survey.', findings: [finding()], challengeRound: null },
    tokens: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, reasoningTokens: 0 },
    latencyMs: 1,
    langfuseTraceId: null,
    replayed: false,
  };
}

function chargingDispatch(id: string, costUsd: number, counter: { calls: number }): (input: DispatchInput) => Promise<DispatchResult> {
  return async () => {
    counter.calls += 1;
    insertDispatch(id, costUsd);
    return successResult();
  };
}

function lensPhase(name: string, artefact: string): EnginePhaseStep<EngineDeps> {
  return {
    name,
    run: async (deps, id) => {
      await runAgent(deps, {
        reviewId: id,
        phase: name,
        agent: 'specialist-reviewer',
        artefactName: artefact,
        assembleInput: { lens: 'Methods and design' },
      });
      upsertCheckpoint(deps.db, { reviewId: id, phase: `engine_${name}`, status: 'completed' });
    },
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-cost-ceiling-'));
  client = createDb(join(tempDir, 'mara.db'));
  runMigrations(client.db);
});

afterEach(() => {
  client.sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  for (const id of reviewIds.splice(0)) {
    rmSync(blobDir(id), { recursive: true, force: true });
  }
});

describe('PIPE-26 cost-ceiling pre-dispatch gate', () => {
  it('pauses before the next dispatch when projected spend breaches the ceiling, at a checkpoint, without issuing it', async () => {
    const id = reviewId();
    insertReview(id);
    writeSetting(client.db, 'cost_ceiling_usd', 0.6);
    const counter = { calls: 0 };
    const deps: EngineDeps = {
      db: client.db,
      runDispatch: chargingDispatch(id, 0.5, counter),
      preDispatch: createCostCeilingGate({ db: client.db, defaultProjectedUsd: 0.01 }),
    };

    const outcome = await runEnginePhases({
      deps,
      reviewId: id,
      phases: [lensPhase('phase_1', 'a'), lensPhase('phase_2', 'b')],
      shouldStop: () => null,
      onPause: (info) => pauseReview(client.db, id, { reason: info.reason, phase: info.phase, ...(info.detail !== undefined ? { detail: info.detail } : {}) }),
    });

    expect(outcome).toBe('paused');
    expect(counter.calls).toBe(1);
    expect(reviewStatus(id)).toBe('paused');
    expect(getReviewOptions(client.db, id).pauseReason).toBe('cost_ceiling');
    expect(getCheckpoint(client.db, id, 'engine_phase_1')?.status).toBe('completed');
    expect(getCheckpoint(client.db, id, 'engine_phase_2')).toBeUndefined();

    const events = client.sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'phase_transition'")
      .all(id) as Array<{ payload_json: string }>;
    const pauseEvent = events.map((row) => JSON.parse(row.payload_json)).find((payload) => payload.paused === true);
    expect(pauseEvent).toMatchObject({ paused: true, reason: 'cost_ceiling' });
  });

  it('resumes from the checkpoint after the ceiling is raised without re-paying completed dispatches', async () => {
    const id = reviewId();
    insertReview(id);
    writeSetting(client.db, 'cost_ceiling_usd', 0.6);
    const counter = { calls: 0 };
    const deps: EngineDeps = {
      db: client.db,
      runDispatch: chargingDispatch(id, 0.5, counter),
      preDispatch: createCostCeilingGate({ db: client.db, defaultProjectedUsd: 0.01 }),
    };
    const phases = [lensPhase('phase_1', 'a'), lensPhase('phase_2', 'b')];
    const pause = (info: { reason: string; phase: string; detail?: Record<string, unknown> }): void =>
      pauseReview(client.db, id, { reason: info.reason, phase: info.phase, ...(info.detail !== undefined ? { detail: info.detail } : {}) });

    await runEnginePhases({ deps, reviewId: id, phases, shouldStop: () => null, onPause: pause });
    expect(counter.calls).toBe(1);

    writeSetting(client.db, 'cost_ceiling_usd', 100);
    const outcome = await runEnginePhases({ deps, reviewId: id, phases, shouldStop: () => null, onPause: pause });

    expect(outcome).toBe('completed');
    expect(counter.calls).toBe(2);
    const rows = client.sqlite.prepare('SELECT count(*) AS n FROM dispatches WHERE review_id = ?').get(id) as { n: number };
    expect(rows.n).toBe(2);
    expect(getCheckpoint(client.db, id, 'engine_phase_2')?.status).toBe('completed');
  });

  it('never gates when no ceiling is configured', async () => {
    const id = reviewId();
    insertReview(id);
    const counter = { calls: 0 };
    const deps: EngineDeps = {
      db: client.db,
      runDispatch: chargingDispatch(id, 5, counter),
      preDispatch: createCostCeilingGate({ db: client.db }),
    };

    const outcome = await runEnginePhases({
      deps,
      reviewId: id,
      phases: [lensPhase('phase_1', 'a'), lensPhase('phase_2', 'b')],
      shouldStop: () => null,
    });

    expect(outcome).toBe('completed');
    expect(counter.calls).toBe(2);
    expect(reviewStatus(id)).not.toBe('paused');
  });

  it('holds a parallel fan-out to the ceiling by counting in-flight dispatches', async () => {
    const id = reviewId();
    insertReview(id);
    writeSetting(client.db, 'cost_ceiling_usd', 3);
    insertDispatch(id, 1);
    insertDispatch(id, 1);
    const counter = { calls: 0 };
    const deps: EngineDeps = {
      db: client.db,
      runDispatch: async () => {
        counter.calls += 1;
        await new Promise((resolve) => setImmediate(resolve));
        insertDispatch(id, 1);
        return successResult();
      },
      preDispatch: createCostCeilingGate({ db: client.db }),
    };
    const fanout: EnginePhaseStep<EngineDeps> = {
      name: 'phase_3',
      run: async (d, rid) => {
        await Promise.all(
          ['fan-a', 'fan-b', 'fan-c', 'fan-d'].map((artefact) =>
            runAgent(d, {
              reviewId: rid,
              phase: 'phase_3',
              agent: 'specialist-reviewer',
              artefactName: artefact,
              assembleInput: { lens: 'Methods and design' },
            }),
          ),
        );
        upsertCheckpoint(d.db, { reviewId: rid, phase: 'engine_phase_3', status: 'completed' });
      },
    };

    const outcome = await runEnginePhases({
      deps,
      reviewId: id,
      phases: [fanout],
      shouldStop: () => null,
      onPause: (info) => pauseReview(client.db, id, { reason: info.reason, phase: info.phase }),
    });

    expect(outcome).toBe('paused');
    expect(counter.calls).toBe(1);
    await new Promise((resolve) => setImmediate(resolve));
    const rows = client.sqlite.prepare('SELECT count(*) AS n FROM dispatches WHERE review_id = ?').get(id) as { n: number };
    expect(rows.n).toBe(3);
    expect(getReviewOptions(client.db, id).pauseReason).toBe('cost_ceiling');
  });

  it('projects from the costliest prior dispatch so zero-cost rows cannot dilute the estimate', async () => {
    const id = reviewId();
    insertReview(id);
    writeSetting(client.db, 'cost_ceiling_usd', 0.8);
    insertDispatch(id, 0);
    insertDispatch(id, 0);
    insertDispatch(id, 0);
    insertDispatch(id, 0.5);
    let issued = 0;
    const deps = {
      db: client.db,
      runDispatch: async () => {
        issued += 1;
        return successResult();
      },
      preDispatch: createCostCeilingGate({ db: client.db }),
    };

    await expect(
      runAgent(deps, { reviewId: id, phase: 'phase_3', agent: 'specialist-reviewer', artefactName: 'zc', assembleInput: { lens: 'Methods and design' } }),
    ).rejects.toBeInstanceOf(DispatchPauseError);
    expect(issued).toBe(0);
  });

  it('re-checks the ceiling before every retry attempt inside runAgent', async () => {
    const id = reviewId();
    insertReview(id);
    writeSetting(client.db, 'cost_ceiling_usd', 1.2);
    insertDispatch(id, 0.5);
    let issued = 0;
    const deps = {
      db: client.db,
      runDispatch: async () => {
        issued += 1;
        insertDispatch(id, 0.5);
        const bad = successResult();
        bad.object = { lens: 'Methods and design' };
        return bad;
      },
      preDispatch: createCostCeilingGate({ db: client.db }),
    };

    await expect(
      runAgent(deps, {
        reviewId: id,
        phase: 'phase_3',
        agent: 'specialist-reviewer',
        artefactName: 'retry-x',
        assembleInput: { lens: 'Methods and design' },
      }),
    ).rejects.toBeInstanceOf(DispatchPauseError);
    expect(issued).toBe(1);
  });

  it('sets and clears the ceiling through the settings API and the gate follows', () => {
    const id = reviewId();
    insertReview(id);
    insertDispatch(id, 5);
    const gate = createCostCeilingGate({ db: client.db });

    expect(putSettings(client.db, { costCeilingUsd: 0.1 }).costCeilingUsd).toBe(0.1);
    expect(getSettings(client.db).costCeilingUsd).toBe(0.1);
    expect(gate({ reviewId: id, phase: 'phase_3', agent: 'specialist-reviewer' }).pause).toBe(true);

    expect(putSettings(client.db, { costCeilingUsd: null }).costCeilingUsd).toBeNull();
    expect(gate({ reviewId: id, phase: 'phase_3', agent: 'specialist-reviewer' }).pause).toBe(false);
  });

  it('honours a per-run manifest override ahead of the global setting', async () => {
    const id = reviewId();
    insertReview(id);
    writeSetting(client.db, 'cost_ceiling_usd', 100);
    mergeReviewOptions(client.db, id, { costCeilingUsd: 0.6 });
    insertDispatch(id, 0.5);
    let issued = 0;
    const deps = {
      db: client.db,
      runDispatch: async () => {
        issued += 1;
        return successResult();
      },
      preDispatch: createCostCeilingGate({ db: client.db }),
    };

    await expect(
      runAgent(deps, { reviewId: id, phase: 'phase_3', agent: 'specialist-reviewer', artefactName: 'x', assembleInput: { lens: 'Methods and design' } }),
    ).rejects.toBeInstanceOf(DispatchPauseError);
    expect(issued).toBe(0);
  });
});
