import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Finding, PhaseCriticDefect, PhaseCriticOutput } from '@mara/shared';
import { createDb, type MaraDatabase, type SqliteConnection } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { getCurrentFindings, mergeFindings } from '../../ledger';
import { blobDir } from '../../paths';
import type { DispatchInput, DispatchResult } from '../../providers/dispatch';
import { writeManuscriptBlob } from '../../workflow/storage';
import { artefactExists, writeArtefact } from '../artefacts';
import type { EngineDeps } from '../phases-shared';
import { runPhaseCritique } from '../phase-critique';

let tempDir: string;
let db: MaraDatabase;
let sqlite: SqliteConnection;
let reviewId: string;

const selfCritique = { strongestObjection: 'Mock output; not derived from evidence.', confidenceRaisers: ['A real dispatch'] };

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: 'REV-XXX-0001',
    lens: 'statistical',
    phase: 3,
    claim: 'A concern.',
    anchor: 'Table 2',
    epistemic: 'Known',
    confidence: 0.9,
    band: 'Yellow',
    severity: 'major',
    fixability: 'moderate',
    scope: 'author-facing',
    failureScenario: 'A validity threat.',
    leanestFix: 'Recompute.',
    supersedes: null,
    ...overrides,
  } as Finding;
}

function defect(overrides: Partial<PhaseCriticDefect> = {}): PhaseCriticDefect {
  return {
    kind: 'missing-coverage',
    severity: 'material',
    description: 'A material coverage gap.',
    redispatchTarget: 'STAT',
    fixInstruction: 'Re-run the statistical lens and supersede REV-STAT-0002 with an anchored finding.',
    ...overrides,
  };
}

function critique(overrides: Partial<PhaseCriticOutput> = {}): PhaseCriticOutput {
  return {
    verdict: 'clean',
    defects: [],
    strongestGap: 'No material gap in the phase outputs.',
    selfCritique,
    ...overrides,
  };
}

function specialistCorrection(): Record<string, unknown> {
  return {
    lens: 'Statistical',
    coreContributionReading: 'A brief wellbeing effect.',
    findings: [finding({ claim: 'The corrected in-range mean.', supersedes: 'REV-STAT-0002' })],
    challengeRound: null,
    selfCritique,
  };
}

function integrityCorrection(): Record<string, unknown> {
  return {
    cluster: 'reporting-and-reproducibility',
    checks: [],
    findings: [finding({ lens: 'REV-RPT', claim: 'A reporting gap.', severity: 'moderate' })],
    selfCritique,
  };
}

function successResult(object: unknown): DispatchResult {
  return {
    dispatchId: 'mock',
    provider: 'anthropic',
    model: 'mock-model',
    status: 'success',
    object,
    tokens: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, reasoningTokens: 0 },
    latencyMs: 1,
    langfuseTraceId: null,
    replayed: false,
  };
}

interface Harness {
  deps: EngineDeps;
  readonly criticCalls: number;
  readonly specialistCalls: number;
  readonly integrityCalls: number;
}

function mockDeps(opts: { critics: PhaseCriticOutput[]; throwCritic?: boolean }): Harness {
  const state = { criticCalls: 0, specialistCalls: 0, integrityCalls: 0 };
  const runDispatch = async (input: DispatchInput): Promise<DispatchResult> => {
    let object: unknown;
    switch (input.agent) {
      case 'phase-critic':
        state.criticCalls += 1;
        if (opts.throwCritic === true) {
          throw new Error('phase-critic dispatch failed');
        }
        object = opts.critics[Math.min(state.criticCalls - 1, opts.critics.length - 1)];
        break;
      case 'specialist-reviewer':
        state.specialistCalls += 1;
        object = specialistCorrection();
        break;
      case 'integrity-screener':
        state.integrityCalls += 1;
        object = integrityCorrection();
        break;
      default:
        throw new Error(`unexpected agent ${input.agent}`);
    }
    return successResult(object);
  };
  return {
    deps: { db, runDispatch },
    get criticCalls() {
      return state.criticCalls;
    },
    get specialistCalls() {
      return state.specialistCalls;
    },
    get integrityCalls() {
      return state.integrityCalls;
    },
  };
}

function seed(preset: string): void {
  const now = new Date().toISOString();
  sqlite
    .prepare('INSERT INTO reviews (id, slug, status, options_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(reviewId, reviewId, 'running', JSON.stringify({ preset, answers: {} }), now, now);
  const sectionMap = {
    title: 'A brief wellbeing trial',
    abstract: 'Abstract text.',
    sections: [{ index: 0, heading: 'Results', text: 'The mean was 8.40.', lineStart: 1, lineEnd: 3 }],
    references: [],
    fullText: 'The mean was 8.40.',
    parser: 'grobid',
    parseQuality: 'good',
  };
  writeManuscriptBlob(reviewId, 'parse/section-map.json', JSON.stringify(sectionMap));
  mergeFindings(db, {
    reviewId,
    lensPrefix: 'STAT',
    phase: 'phase_3',
    agent: 'specialist-reviewer',
    fragments: [finding({ claim: 'Impossible mean.' }), finding({ claim: 'Missing test statistic.' })],
  });
}

function phaseCritiqueEvents(): Array<Record<string, unknown>> {
  const rows = sqlite
    .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'phase_critique' ORDER BY seq")
    .all(reviewId) as Array<{ payload_json: string }>;
  return rows.map((row) => JSON.parse(row.payload_json) as Record<string, unknown>);
}

function eventKinds(kind: string): number {
  return (
    sqlite.prepare('SELECT count(*) AS n FROM review_events WHERE review_id = ? AND kind = ?').get(reviewId, kind) as {
      n: number;
    }
  ).n;
}

function seedRedispatchedEvent(seq: number, phase: string): void {
  sqlite
    .prepare('INSERT INTO review_events (id, review_id, seq, ts, kind, phase, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      randomUUID(),
      reviewId,
      seq,
      new Date().toISOString(),
      'phase_critique',
      phase,
      JSON.stringify({ phase, verdict: 'redispatch', defectCount: 1, materialCount: 1, redispatched: true, headline: 'prior' }),
    );
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-pcrit-'));
  const client = createDb(join(tempDir, 'mara.db'));
  db = client.db;
  sqlite = client.sqlite;
  runMigrations(db);
  reviewId = `pcrit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(blobDir(reviewId), { recursive: true, force: true });
});

describe('per-phase adversarial critic', () => {
  it('logs a clean verdict without re-dispatching', async () => {
    seed('balanced');
    const h = mockDeps({ critics: [critique({ verdict: 'clean' })] });
    await runPhaseCritique(h.deps, reviewId, 'phase_3', [{ label: 'Findings', content: 'summary' }]);
    const events = phaseCritiqueEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.verdict).toBe('clean');
    expect(events[0]?.redispatched).toBe(false);
    expect(events[0]?.headline).toBe('Phase critic passed the phase outputs');
    expect(h.specialistCalls).toBe(0);
  });

  it('re-dispatches exactly once to a valid lens target and applies the superseding merge', async () => {
    seed('balanced');
    const h = mockDeps({
      critics: [critique({ verdict: 'redispatch', defects: [defect({ redispatchTarget: 'STAT' })] })],
    });
    await runPhaseCritique(h.deps, reviewId, 'phase_3', [{ label: 'Findings', content: 'summary' }]);
    expect(h.specialistCalls).toBe(1);
    const ids = getCurrentFindings(db, reviewId).map((entry) => entry.id);
    expect(ids).not.toContain('REV-STAT-0002');
    expect(ids.some((id) => id.startsWith('REV-STAT-'))).toBe(true);
    const events = phaseCritiqueEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.redispatched).toBe(true);
    expect(events[0]?.headline).toContain('re-dispatched the statistical lens');
  });

  it('re-dispatches on the third phase, covering context, specialists, and integrity each once', async () => {
    seed('balanced');
    seedRedispatchedEvent(1, 'phase_1');
    seedRedispatchedEvent(2, 'phase_2');
    const h = mockDeps({
      critics: [critique({ verdict: 'redispatch', defects: [defect({ redispatchTarget: 'STAT' })] })],
    });
    await runPhaseCritique(h.deps, reviewId, 'phase_3', [{ label: 'Findings', content: 'summary' }]);
    expect(h.specialistCalls).toBe(1);
    const last = phaseCritiqueEvents().at(-1);
    expect(last?.redispatched).toBe(true);
  });

  it('respects the three-per-run re-dispatch cap', async () => {
    seed('balanced');
    seedRedispatchedEvent(1, 'phase_1');
    seedRedispatchedEvent(2, 'phase_2');
    seedRedispatchedEvent(3, 'phase_4');
    const h = mockDeps({
      critics: [critique({ verdict: 'redispatch', defects: [defect({ redispatchTarget: 'STAT' })] })],
    });
    await runPhaseCritique(h.deps, reviewId, 'phase_3', [{ label: 'Findings', content: 'summary' }]);
    expect(h.specialistCalls).toBe(0);
    const events = phaseCritiqueEvents();
    const last = events[events.length - 1];
    expect(last?.redispatched).toBe(false);
    expect(getCurrentFindings(db, reviewId).map((entry) => entry.id)).toContain('REV-STAT-0002');
  });

  it('logs without re-dispatch when the target is not a finding-producing agent', async () => {
    seed('balanced');
    const h = mockDeps({
      critics: [critique({ verdict: 'redispatch', defects: [defect({ redispatchTarget: 'swarm' })] })],
    });
    await runPhaseCritique(h.deps, reviewId, 'phase_3', [{ label: 'Findings', content: 'summary' }]);
    expect(h.specialistCalls).toBe(0);
    const events = phaseCritiqueEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.redispatched).toBe(false);
  });

  it('logs without re-dispatch when the target is null', async () => {
    seed('balanced');
    const h = mockDeps({
      critics: [critique({ verdict: 'redispatch', defects: [defect({ redispatchTarget: null })] })],
    });
    await runPhaseCritique(h.deps, reviewId, 'phase_3', [{ label: 'Findings', content: 'summary' }]);
    expect(h.specialistCalls).toBe(0);
    expect(phaseCritiqueEvents()[0]?.redispatched).toBe(false);
  });

  it('never lets a critic dispatch failure escape or block the phase', async () => {
    seed('balanced');
    const h = mockDeps({ critics: [critique()], throwCritic: true });
    await expect(
      runPhaseCritique(h.deps, reviewId, 'phase_3', [{ label: 'Findings', content: 'summary' }]),
    ).resolves.toBeUndefined();
    expect(phaseCritiqueEvents()).toHaveLength(0);
    expect(eventKinds('error')).toBe(1);
  });

  it('runs only after phase 6 on the fast preset, log-only', async () => {
    seed('fast');
    const h = mockDeps({
      critics: [critique({ verdict: 'redispatch', defects: [defect({ redispatchTarget: 'STAT' })] })],
    });
    await runPhaseCritique(h.deps, reviewId, 'phase_3', [{ label: 'Findings', content: 'summary' }]);
    expect(h.criticCalls).toBe(0);
    expect(phaseCritiqueEvents()).toHaveLength(0);

    await runPhaseCritique(h.deps, reviewId, 'phase_6', [{ label: 'Report', content: 'summary' }]);
    expect(h.criticCalls).toBe(1);
    const events = phaseCritiqueEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.redispatched).toBe(false);
    expect(h.specialistCalls).toBe(0);
  });

  it('keeps fixture claim text out of the phase_critique event payload', async () => {
    seed('balanced');
    const sentinel = 'ZZZSENTINELCLAIMZZZ';
    mergeFindings(db, {
      reviewId,
      lensPrefix: 'METH',
      phase: 'phase_3',
      agent: 'specialist-reviewer',
      fragments: [finding({ lens: 'methods', claim: sentinel })],
    });
    const h = mockDeps({
      critics: [
        critique({
          verdict: 'clean',
          defects: [defect({ severity: 'note', redispatchTarget: null, description: sentinel, fixInstruction: sentinel })],
        }),
      ],
    });
    await runPhaseCritique(h.deps, reviewId, 'phase_3', [{ label: 'Findings', content: sentinel }]);
    const rows = sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'phase_critique'")
      .all(reviewId) as Array<{ payload_json: string }>;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(sentinel);
  });

  it('is idempotent across a mid-phase restart: no second event and no budget spend', async () => {
    seed('balanced');
    const h = mockDeps({
      critics: [critique({ verdict: 'redispatch', defects: [defect({ redispatchTarget: 'STAT' })] })],
    });
    await runPhaseCritique(h.deps, reviewId, 'phase_3', [{ label: 'Findings', content: 'summary' }]);
    await runPhaseCritique(h.deps, reviewId, 'phase_3', [{ label: 'Findings', content: 'summary' }]);
    expect(h.criticCalls).toBe(1);
    expect(h.specialistCalls).toBe(1);
    expect(phaseCritiqueEvents()).toHaveLength(1);
  });

  it('routes a reproducibility-worded phase 4 target to the reporting cluster, never consistency by substring', async () => {
    seed('balanced');
    writeArtefact(reviewId, 'p1-analyst-a', { manuscriptMap: [], figureTableInventory: [] });
    writeArtefact(reviewId, 'p1-analyst-b', { claimEvidenceMatrix: [] });
    const h = mockDeps({
      critics: [critique({ verdict: 'redispatch', defects: [defect({ redispatchTarget: 'a reproducibility concern' })] })],
    });
    await runPhaseCritique(h.deps, reviewId, 'phase_4', [{ label: 'Integrity outputs', content: 'summary' }]);
    expect(h.integrityCalls).toBe(1);
    expect(artefactExists(reviewId, 'p4-critfix-reporting-and-reproducibility')).toBe(true);
    expect(artefactExists(reviewId, 'p4-critfix-consistency-and-figures')).toBe(false);
    expect(getCurrentFindings(db, reviewId).some((entry) => entry.id.startsWith('REV-RPT-'))).toBe(true);
    const events = phaseCritiqueEvents();
    expect(events[0]?.redispatched).toBe(true);
    expect(events[0]?.headline).toContain('reporting-and-reproducibility integrity cluster');
  });
});
