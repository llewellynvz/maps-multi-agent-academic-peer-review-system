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
import { readArtefact, writeArtefact } from '../artefacts';
import { DispatchPauseError, type EngineDeps } from '../phases-shared';
import { runPhase7 } from '../phase7';

let tempDir: string;
let db: MaraDatabase;
let sqlite: SqliteConnection;
let reviewId: string;

const AUTHOR_IDS = ['REV-STAT-0001', 'REV-STAT-0002', 'REV-METH-0001'];

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
    editorSummaryMarkdown: 'The decision rests on REV-STAT-0001. The strongest alternative reading holds that the effect survives the statistical concern.',
    selfCritique,
  };
}

function shippedObject() {
  return {
    mode: 'B',
    recommendation: 'major_revision',
    recommendationConfidence: 0.8,
    bodyMarkdown: [
      'Dear Editor and Authors, I recommend major revision, and I hold this with moderate confidence.',
      '**The reported mean is impossible.** Table 2 reports a value outside the scale range.',
      '**Sampling is under-described.** The frame and exclusions are not yet reported.',
    ].join('\n\n'),
    evidenceMap: [
      {
        section: '4A.1',
        label: 'The reported mean is impossible.',
        anchor: 'Table 2',
        findingIds: ['REV-STAT-0001', 'REV-STAT-0002'],
      },
      { section: '4A.2', label: 'Sampling is under-described.', anchor: 'Methods', findingIds: ['REV-METH-0001'] },
    ],
    rubricTable: Array.from({ length: 15 }, (_unused, index) => ({
      criterion: index + 1,
      score: 3,
      justification: 'Grounded in the ledger.',
    })),
    references: [],
    citedFindingIds: AUTHOR_IDS,
    editorOnlyLeak: false,
    humanizePairs: [
      { before: 'a', after: 'b' },
      { before: 'c', after: 'd' },
      { before: 'e', after: 'f' },
    ],
    selfCritique,
  };
}

function swarmBObject() {
  return { mode: 'B', critique: [], selfCritique };
}

function specialistObject() {
  return {
    lens: 'Statistical',
    coreContributionReading: 'A brief wellbeing effect.',
    findings: [finding({ claim: 'Corrected statistic reported for the record.', supersedes: null })],
    challengeRound: null,
    selfCritique,
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
    selfCritique,
    ...overrides,
  };
}

function mockDeps(
  criticVerdicts: ReviewFinalCriticOutput[],
  shippedOverride?: ReturnType<typeof shippedObject>,
  metaSequence?: Array<ReturnType<typeof metaObject>>,
  shippedSequence?: Array<ReturnType<typeof shippedObject>>,
): { deps: EngineDeps; criticCalls: number; specialistCalls: string[]; writerInputs: string[] } {
  const state = { criticCalls: 0, metaCalls: 0, writerCalls: 0, specialistCalls: [] as string[], writerInputs: [] as string[] };
  const runDispatch = async (input: DispatchInput): Promise<DispatchResult> => {
    let object: unknown;
    switch (input.agent) {
      case 'review-meta-reviewer':
        object = metaSequence?.[Math.min(state.metaCalls, metaSequence.length - 1)] ?? metaObject();
        state.metaCalls += 1;
        break;
      case 'swarm':
        object = swarmBObject();
        break;
      case 'review-report-writer':
        state.writerInputs.push(JSON.stringify(input));
        object =
          shippedSequence?.[Math.min(state.writerCalls, shippedSequence.length - 1)] ?? shippedOverride ?? shippedObject();
        state.writerCalls += 1;
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
    get writerInputs() {
      return state.writerInputs;
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

  it('routes back a shipped body that carries inline finding ids, with the id-free instruction', async () => {
    const withInlineId = {
      ...shippedObject(),
      bodyMarkdown: `${shippedObject().bodyMarkdown}\n\nSee REV-STAT-0001 for the full detail.`,
    };
    const harness = mockDeps([critic('pass')], withInlineId);
    await runPhase7(harness.deps, reviewId);
    expect(harness.criticCalls).toBe(0);
    expect(checkpointRow().snapshot.released).toBe(false);
    expect(harness.writerInputs.length).toBeGreaterThanOrEqual(2);
    expect(harness.writerInputs[1]).toContain('id-free');
  });

  it('routes back machine tokens in the shipped prose, with the natural-prose instruction', async () => {
    const withTokens = {
      ...shippedObject(),
      bodyMarkdown: `${shippedObject().bodyMarkdown}\n\nDecision: major_revision | Confidence: 0.78`,
    };
    const harness = mockDeps([critic('pass')], withTokens);
    await runPhase7(harness.deps, reviewId);
    expect(harness.criticCalls).toBe(0);
    expect(checkpointRow().snapshot.released).toBe(false);
    expect(harness.writerInputs[1]).toContain('natural reviewer prose');
    expect(harness.writerInputs[1]).toContain('major_revision');
  });

  it('routes back an evidence map whose labels are missing from the body', async () => {
    const brokenMap = { ...shippedObject(), bodyMarkdown: 'Dear Editor and Authors, I recommend major revision.' };
    const harness = mockDeps([critic('pass')], brokenMap);
    await runPhase7(harness.deps, reviewId);
    expect(harness.criticCalls).toBe(0);
    expect(checkpointRow().snapshot.released).toBe(false);
    expect(harness.writerInputs[1]).toContain('evidence map');
  });

  it('derives citedFindingIds from the evidence map when the writer omits an id', async () => {
    const sloppyUnion = { ...shippedObject(), citedFindingIds: ['REV-STAT-0001'] };
    const harness = mockDeps([critic('pass')], sloppyUnion);
    await runPhase7(harness.deps, reviewId);
    expect(checkpointRow().snapshot.released).toBe(true);
    const final = readArtefact<{ citedFindingIds: string[] }>(reviewId, 'p7-shipped-final');
    expect([...final.citedFindingIds].sort()).toEqual([...AUTHOR_IDS].sort());
  });

  it('embeds the meta editorial synthesis in the private notes with superseded ids masked', async () => {
    const harness = mockDeps([critic('pass')]);
    await runPhase7(harness.deps, reviewId);
    const notes = readArtefact<{ markdown: string }>(reviewId, 'p7-private-notes-final');
    expect(notes.markdown).toContain('## Editorial synthesis');
    expect(notes.markdown).toContain('strongest alternative reading');
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

  it('persists the refreshed meta after a revise-specialist re-dispatch, not the stale first meta', async () => {
    const first = { ...metaObject(), recommendation: 'major_revision', recommendationConfidence: 0.8 };
    const second = { ...metaObject(), recommendation: 'minor_revision', recommendationConfidence: 0.6 };
    const harness = mockDeps(
      [critic('revise-specialist', { lens: 'STAT', findingIdToSupersede: 'REV-STAT-0002' }), critic('pass')],
      undefined,
      [first, second],
    );
    await runPhase7(harness.deps, reviewId);

    const cp = checkpointRow();
    expect(cp.snapshot.released).toBe(true);
    expect(cp.snapshot.recommendation).toBe('minor_revision');
    expect(cp.snapshot.recommendationConfidence).toBeCloseTo(0.6);

    const review = sqlite
      .prepare('SELECT recommendation, recommendation_confidence FROM reviews WHERE id = ?')
      .get(reviewId) as { recommendation: string; recommendation_confidence: number };
    expect(review.recommendation).toBe('minor_revision');
    expect(review.recommendation_confidence).toBeCloseTo(0.6);

    const gateRecord = readArtefact<{ recommendation: string; recommendationConfidence: number }>(reviewId, 'p7-gate-record');
    expect(gateRecord.recommendation).toBe('minor_revision');
    expect(gateRecord.recommendationConfidence).toBeCloseTo(0.6);
  });

  it('preserves the validated evidence map when the alignment writer fabricates an id', async () => {
    const fabricated = {
      ...shippedObject(),
      recommendation: 'reject_and_resubmit',
      evidenceMap: [
        { section: '4A.1', label: 'The reported mean is impossible.', anchor: 'Table 2', findingIds: ['REV-CTX-9313'] },
      ],
      citedFindingIds: ['REV-CTX-9313'],
    };
    const harness = mockDeps(
      [critic('revise'), critic('revise')],
      undefined,
      undefined,
      [shippedObject(), shippedObject(), shippedObject(), fabricated],
    );
    await runPhase7(harness.deps, reviewId);
    expect(checkpointRow().snapshot.released).toBe(true);
    const final = readArtefact<{ citedFindingIds: string[]; evidenceMap: Array<{ findingIds: string[] }> }>(
      reviewId,
      'p7-shipped-final',
    );
    expect(final.evidenceMap.flatMap((entry) => entry.findingIds)).not.toContain('REV-CTX-9313');
    expect([...final.citedFindingIds].sort()).toEqual([...AUTHOR_IDS].sort());
  });

  it('aligns the released report with the arbitration-narrowed recommendation', async () => {
    const narrowedEnvelope = { ...shippedObject(), recommendation: 'reject_and_resubmit' };
    const harness = mockDeps(
      [critic('revise'), critic('revise')],
      undefined,
      undefined,
      [shippedObject(), shippedObject(), shippedObject(), narrowedEnvelope],
    );
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.snapshot.released).toBe(true);
    const review = sqlite.prepare('SELECT recommendation FROM reviews WHERE id = ?').get(reviewId) as { recommendation: string };
    expect(review.recommendation).toBe('reject_and_resubmit');
    const finalShipped = readArtefact<{ recommendation: string }>(reviewId, 'p7-shipped-final');
    expect(finalShipped.recommendation).toBe('reject_and_resubmit');
    const alignEvents = sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'gate_verdict'")
      .all(reviewId)
      .map((row) => JSON.parse((row as { payload_json: string }).payload_json) as { source: string; verdict: string });
    expect(alignEvents.some((event) => event.source === 'arbitration-alignment' && event.verdict === 'aligned')).toBe(true);
  });

  it('propagates a cost-ceiling pause at the alignment dispatch instead of blocking the release', async () => {
    const narrowedEnvelope = { ...shippedObject(), recommendation: 'reject_and_resubmit' };
    const harness = mockDeps(
      [critic('revise'), critic('revise')],
      undefined,
      undefined,
      [shippedObject(), shippedObject(), shippedObject(), narrowedEnvelope],
    );
    let writerGateCalls = 0;
    const deps: EngineDeps = {
      ...harness.deps,
      preDispatch: (info) => {
        if (info.agent === 'review-report-writer') {
          writerGateCalls += 1;
          if (writerGateCalls >= 4) {
            return { pause: true, reason: 'cost_ceiling' };
          }
        }
        return { pause: false };
      },
    };
    await expect(runPhase7(deps, reviewId)).rejects.toBeInstanceOf(DispatchPauseError);
    const review = sqlite.prepare('SELECT status FROM reviews WHERE id = ?').get(reviewId) as { status: string };
    expect(review.status).toBe('running');
    const gateEvents = sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'gate_verdict'")
      .all(reviewId)
      .map((row) => JSON.parse((row as { payload_json: string }).payload_json) as { source?: string; verdict?: string });
    expect(gateEvents.some((event) => event.source === 'arbitration-alignment' && event.verdict === 'block')).toBe(false);
    expect(eventKinds()).not.toContain('run_terminal');

    await runPhase7(harness.deps, reviewId);
    const resumed = sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'gate_verdict'")
      .all(reviewId)
      .map((row) => JSON.parse((row as { payload_json: string }).payload_json) as { cycle: number; source: string; verdict: string });
    const triples = resumed.map((event) => `${event.cycle}|${event.source}|${event.verdict}`);
    expect(new Set(triples).size).toBe(triples.length);
    expect(checkpointRow().snapshot.released).toBe(true);
  });

  it('halts instead of releasing a report that cannot be aligned with the narrowed recommendation', async () => {
    const harness = mockDeps([critic('revise'), critic('revise')]);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.snapshot.released).toBe(false);
    const review = sqlite.prepare('SELECT status FROM reviews WHERE id = ?').get(reviewId) as { status: string };
    expect(review.status).toBe('failed');
    const alignEvents = sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'gate_verdict'")
      .all(reviewId)
      .map((row) => JSON.parse((row as { payload_json: string }).payload_json) as { source: string; verdict: string });
    expect(alignEvents.some((event) => event.source === 'arbitration-alignment' && event.verdict === 'block')).toBe(true);
  });

  it('never shows superseded ids to the writer: stale ids in upstream artefacts are masked', async () => {
    mergeFindings(db, {
      reviewId,
      lensPrefix: 'STAT',
      phase: 'phase_3',
      agent: 'specialist-reviewer',
      fragments: [finding({ lens: 'statistical', claim: 'A first-pass reading later corrected.' })],
    });
    mergeFindings(db, {
      reviewId,
      lensPrefix: 'STAT',
      phase: 'phase_5',
      agent: 'specialist-reviewer',
      fragments: [finding({ lens: 'statistical', claim: 'The corrected reading.', supersedes: 'REV-STAT-0003' })],
    });
    writeArtefact(reviewId, 'p6-report', {
      mode: 'A',
      bodyMarkdown: 'Full internal report referencing REV-STAT-0001 and the earlier REV-STAT-0003 reading.',
    });
    const harness = mockDeps([critic('pass')]);
    await runPhase7(harness.deps, reviewId);
    expect(harness.writerInputs.length).toBeGreaterThanOrEqual(1);
    for (const input of harness.writerInputs) {
      expect(input).not.toContain('REV-STAT-0003');
      expect(input).toContain('[SUPERSEDED]');
    }
  });

  it('never shows editor-only ids to the writer, even after a leak-triggered revise', async () => {
    writeArtefact(reviewId, 'p6-report', {
      mode: 'A',
      bodyMarkdown: 'Full internal report referencing REV-STAT-0001 and the editorial signal REV-SIM-0001.',
    });
    const leaking = {
      ...shippedObject(),
      bodyMarkdown: 'Dear Authors, the central concern is REV-STAT-0001, and note REV-SIM-0001.',
    };
    const harness = mockDeps([critic('pass')], leaking);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.snapshot.released).toBe(false);
    expect(harness.writerInputs.length).toBeGreaterThanOrEqual(2);
    for (const input of harness.writerInputs) {
      expect(input).not.toContain('REV-SIM-0001');
      expect(input).toContain('[EDITOR-ONLY]');
    }
  });
});
