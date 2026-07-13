import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Finding, ReviewFinalCriticOutput } from '@mara/shared';
import { createDb, type MaraDatabase, type SqliteConnection } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { mergeFindings } from '../../ledger';
import type { DispatchInput, DispatchResult } from '../../providers/dispatch';
import { blobDir } from '../../paths';
import { writeManuscriptBlob } from '../../workflow/storage';
import { writeArtefact } from '../artefacts';
import type { EngineDeps } from '../phases-shared';
import { runPhase7 } from '../phase7';

let tempDir: string;
let db: MaraDatabase;
let sqlite: SqliteConnection;
let reviewId: string;

const AUTHOR_IDS = ['REV-STAT-0001', 'REV-STAT-0002', 'REV-METH-0001'];

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

function seedLedger(): void {
  mergeFindings(db, {
    reviewId,
    lensPrefix: 'STAT',
    phase: 'phase_3',
    agent: 'specialist-reviewer',
    fragments: [finding({ claim: 'Impossible mean.' }), finding({ claim: 'Missing test statistic.' })],
  });
  mergeFindings(db, {
    reviewId,
    lensPrefix: 'METH',
    phase: 'phase_3',
    agent: 'specialist-reviewer',
    fragments: [finding({ lens: 'methods', claim: 'Sampling under-described.' })],
  });
  mergeFindings(db, {
    reviewId,
    lensPrefix: 'SIM',
    phase: 'phase_4',
    agent: 'integrity-screener',
    fragments: [finding({ lens: 'similarity', claim: 'Overlap signal for editorial review.', scope: 'editor-only' })],
  });
}

function seedContext(): void {
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
  writeArtefact(reviewId, 'p6-report', { mode: 'A', bodyMarkdown: 'Full internal report referencing REV-STAT-0001.' });
  writeArtefact(reviewId, 'p5-swarm', {
    mode: 'A',
    decisionStability: 0.7,
    strongestMinorityReport: 'A dissent that a subgroup effect may hold.',
  });
  writeArtefact(reviewId, 'p1-analyst-b', { studyDesign: 'randomized-trial' });
}

function metaObject() {
  return {
    rubric: Array.from({ length: 15 }, (_unused, index) => ({
      criterion: index + 1,
      score: 3,
      supportingIds: ['REV-STAT-0001'],
      opposingIds: [],
    })),
    average: 3.0,
    bottlenecks: [4, 5, 9],
    recommendation: 'major_revision',
    recommendationConfidence: 0.8,
    scopeFit: { score: 0.7, factorsUsed: ['topic-fit'] },
    decisionHinges: [
      { findingId: 'REV-STAT-0001', hinge: 'Until resolved, cannot advance beyond major revision.' },
      { findingId: 'REV-METH-0001', hinge: 'Sampling must be clarified.' },
    ],
  };
}

function shippedObject() {
  return {
    mode: 'B',
    recommendation: 'major_revision',
    recommendationConfidence: 0.8,
    bodyMarkdown: `Dear Editor and Authors, the central concern is REV-STAT-0001, with REV-STAT-0002 and REV-METH-0001.`,
    rubricTable: Array.from({ length: 15 }, (_unused, index) => ({
      criterion: index + 1,
      score: 3,
      justification: 'Grounded in the ledger.',
    })),
    references: [],
    citedFindingIds: AUTHOR_IDS,
    editorOnlyLeak: false,
  };
}

function swarmBObject() {
  return { mode: 'B', critique: [] };
}

function specialistObject() {
  return {
    lens: 'Statistical',
    coreContributionReading: 'A brief wellbeing effect.',
    findings: [finding({ claim: 'Corrected statistic reported for the record.', supersedes: null })],
    challengeRound: null,
  };
}

function critic(verdict: ReviewFinalCriticOutput['verdict'], overrides: Partial<ReviewFinalCriticOutput> = {}): ReviewFinalCriticOutput {
  return {
    verdict,
    lens: null,
    sectionsToRework: [],
    findingIdToSupersede: null,
    failureConstructionAttempt: 'I tried to build a failing input.',
    escalatedInconsistencies: [],
    mostDangerousDefect: null,
    ...overrides,
  };
}

function mockDeps(
  criticVerdicts: ReviewFinalCriticOutput[],
  shippedOverride?: ReturnType<typeof shippedObject>,
): { deps: EngineDeps; criticCalls: number; specialistCalls: string[] } {
  const state = { criticCalls: 0, specialistCalls: [] as string[] };
  const runDispatch = async (input: DispatchInput): Promise<DispatchResult> => {
    let object: unknown;
    switch (input.agent) {
      case 'review-meta-reviewer':
        object = metaObject();
        break;
      case 'swarm':
        object = swarmBObject();
        break;
      case 'review-report-writer':
        object = shippedOverride ?? shippedObject();
        break;
      case 'specialist-reviewer':
        state.specialistCalls.push(input.phase);
        object = specialistObject();
        break;
      case 'review-final-critic':
        object = criticVerdicts[Math.min(state.criticCalls, criticVerdicts.length - 1)];
        state.criticCalls += 1;
        break;
      default:
        throw new Error(`unexpected agent ${input.agent}`);
    }
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
  };
  return {
    deps: { db, runDispatch },
    get criticCalls() {
      return state.criticCalls;
    },
    get specialistCalls() {
      return state.specialistCalls;
    },
  };
}

function checkpointRow(): { status: string; gate: string | null; cycles: number; snapshot: Record<string, unknown> } {
  const row = sqlite
    .prepare('SELECT status, gate_verdict, fix_cycle_count, snapshot_json FROM phase_checkpoints WHERE review_id = ? AND phase = ?')
    .get(reviewId, 'engine_phase_7') as { status: string; gate_verdict: string | null; fix_cycle_count: number; snapshot_json: string | null };
  return {
    status: row.status,
    gate: row.gate_verdict,
    cycles: row.fix_cycle_count,
    snapshot: row.snapshot_json !== null ? JSON.parse(row.snapshot_json) : {},
  };
}

function eventKinds(): string[] {
  const rows = sqlite.prepare('SELECT kind FROM review_events WHERE review_id = ? ORDER BY seq').all(reviewId) as Array<{ kind: string }>;
  return rows.map((row) => row.kind);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-p7-'));
  const client = createDb(join(tempDir, 'mara.db'));
  db = client.db;
  sqlite = client.sqlite;
  runMigrations(db);
  reviewId = `p7-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  sqlite
    .prepare('INSERT INTO reviews (id, slug, status, options_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(reviewId, reviewId, 'running', JSON.stringify({ preset: 'fast', answers: { journal: 'PLOS ONE', field: 'wellbeing science' } }), now, now);
  seedLedger();
  seedContext();
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(blobDir(reviewId), { recursive: true, force: true });
});

describe('phase 7 release gate routing', () => {
  it('routes a pass verdict to release with zero fix cycles', async () => {
    const harness = mockDeps([critic('pass')]);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.status).toBe('completed');
    expect(cp.snapshot.released).toBe(true);
    expect(cp.snapshot.verdict).toBe('pass');
    expect(cp.cycles).toBe(0);
    const review = sqlite.prepare('SELECT status, recommendation FROM reviews WHERE id = ?').get(reviewId) as { status: string; recommendation: string };
    expect(review.recommendation).toBe('major_revision');
  });

  it('routes a block verdict to a halted, unreleased run', async () => {
    const harness = mockDeps([critic('block', { mostDangerousDefect: 'A leaked confidential identity.' })]);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.gate).toBe('block');
    expect(cp.snapshot.released).toBe(false);
    const review = sqlite.prepare('SELECT status FROM reviews WHERE id = ?').get(reviewId) as { status: string };
    expect(review.status).toBe('failed');
    expect(harness.criticCalls).toBe(1);
  });

  it('recovers from a revise verdict then releases on the next pass', async () => {
    const harness = mockDeps([critic('revise', { sectionsToRework: ['Developmental feedback'] }), critic('pass')]);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.snapshot.released).toBe(true);
    expect(cp.cycles).toBe(1);
    expect(harness.criticCalls).toBe(2);
  });

  it('re-dispatches the named specialist lens on revise-specialist then releases', async () => {
    const harness = mockDeps([
      critic('revise-specialist', { lens: 'STAT', findingIdToSupersede: 'REV-STAT-0002' }),
      critic('pass'),
    ]);
    await runPhase7(harness.deps, reviewId);
    expect(harness.specialistCalls).toContain('phase_7');
    const cp = checkpointRow();
    expect(cp.snapshot.released).toBe(true);
    expect(cp.cycles).toBe(1);
  });

  it('caps at two fix cycles counting revise and revise-specialist together, then arbitrates', async () => {
    const harness = mockDeps([
      critic('revise', { sectionsToRework: ['Executive summary'] }),
      critic('revise-specialist', { lens: 'METH', findingIdToSupersede: 'REV-METH-0001' }),
      critic('pass'),
    ]);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.gate).toBe('arbitrated');
    expect(cp.cycles).toBe(2);
    expect(eventKinds()).toContain('arbitration');
    expect(harness.criticCalls).toBe(2);
  });

  it('halts at arbitration rather than shipping a deliverable that keeps failing grounding', async () => {
    const ungrounded = { ...shippedObject(), bodyMarkdown: 'The central concern is REV-ZZZ-9999.', citedFindingIds: ['REV-ZZZ-9999'] };
    const harness = mockDeps([critic('pass')], ungrounded);
    await runPhase7(harness.deps, reviewId);
    expect(harness.criticCalls).toBe(0);
    const cp = checkpointRow();
    expect(cp.gate).toBe('arbitrated');
    expect(cp.snapshot.released).toBe(false);
    const arbitration = sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'arbitration'")
      .get(reviewId) as { payload_json: string };
    expect((JSON.parse(arbitration.payload_json) as { outcome: string }).outcome).toBe('halt');
    const review = sqlite.prepare('SELECT status FROM reviews WHERE id = ?').get(reviewId) as { status: string };
    expect(review.status).toBe('failed');
    const deliverableCount = (sqlite.prepare('SELECT count(*) AS n FROM deliverables WHERE review_id = ?').get(reviewId) as { n: number }).n;
    expect(deliverableCount).toBe(0);
  });

  it('does not let the writer self-certify: release requires the critic verdict node', async () => {
    const harness = mockDeps([critic('block', { mostDangerousDefect: 'Ungroundable recommendation.' })]);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.snapshot.released).toBe(false);
    const gateEvents = sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'gate_verdict'")
      .all(reviewId) as Array<{ payload_json: string }>;
    const sources = gateEvents.map((row) => (JSON.parse(row.payload_json) as { source: string }).source);
    expect(sources).toContain('final-critic');
  });
});
