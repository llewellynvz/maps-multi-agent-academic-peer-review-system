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
      opposingIds: [] as string[],
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

const HUMANISED = [
  'Table 2 reports a mean of 6.8 on a five-point scale, which cannot occur.',
  'The sampling frame and the exclusions are not reported, so attrition cannot be assessed.',
  'The Discussion reads the association as causal, which the design cannot support.',
];

// The band check measures the real narrative, so the fixture carries a realistic body rather than three lines.
function narrativeFiller(wordCount: number): string {
  const sentence = 'The manuscript reports the estimate and the supplementary material describes each analytic step in full detail.';
  const perSentence = sentence.split(' ').length;
  return Array.from({ length: Math.ceil(wordCount / perSentence) }, () => sentence).join(' ');
}

function shippedObject() {
  return {
    mode: 'B',
    recommendation: 'major_revision',
    recommendationConfidence: 0.8,
    bodyMarkdown: [
      'Dear Editor and Authors, I recommend major revision, and I hold this with moderate confidence.',
      `**The reported mean is impossible.** ${HUMANISED[0]}`,
      `**Sampling is under-described.** ${HUMANISED[1]}`,
      HUMANISED[2],
      narrativeFiller(4500),
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
    references: [] as string[],
    citedFindingIds: AUTHOR_IDS,
    editorOnlyLeak: false,
    humanizePairs: [
      { before: 'It is worth noting that the reported mean appears somewhat problematic.', after: HUMANISED[0] },
      { before: 'Furthermore, the sampling approach could benefit from additional clarification.', after: HUMANISED[1] },
      { before: 'The Discussion sheds light on the causal nature of the association.', after: HUMANISED[2] },
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
): { deps: EngineDeps; criticCalls: number; specialistCalls: string[]; writerInputs: string[]; criticInputs: string[]; swarmInputs: string[] } {
  const state = {
    criticCalls: 0,
    metaCalls: 0,
    writerCalls: 0,
    specialistCalls: [] as string[],
    writerInputs: [] as string[],
    criticInputs: [] as string[],
    swarmInputs: [] as string[],
  };
  const runDispatch = async (input: DispatchInput): Promise<DispatchResult> => {
    let object: unknown;
    switch (input.agent) {
      case 'review-meta-reviewer':
        object = metaSequence?.[Math.min(state.metaCalls, metaSequence.length - 1)] ?? metaObject();
        state.metaCalls += 1;
        break;
      case 'swarm':
        state.swarmInputs.push(JSON.stringify(input));
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
        state.criticInputs.push(JSON.stringify(input));
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
    get criticInputs() {
      return state.criticInputs;
    },
    get swarmInputs() {
      return state.swarmInputs;
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

  it('routes a persistent block verdict to a halted, unreleased run after one route-back', async () => {
    const harness = mockDeps([
      critic('block', { mostDangerousDefect: 'A leaked confidential identity.' }),
      critic('block', { mostDangerousDefect: 'The identity leak survived the rewrite.' }),
    ]);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.gate).toBe('block');
    expect(cp.snapshot.released).toBe(false);
    const review = sqlite.prepare('SELECT status FROM reviews WHERE id = ?').get(reviewId) as { status: string };
    expect(review.status).toBe('failed');
    expect(harness.criticCalls).toBe(2);
  });

  it('routes a block back to the writer once, naming sections but never the critic prose, then releases', async () => {
    const harness = mockDeps([
      critic('block', {
        mostDangerousDefect: 'The rubric exposes an internal coverage judgement.',
        sectionsToRework: ['Rubric table'],
      }),
      critic('pass'),
    ]);
    await runPhase7(harness.deps, reviewId);
    expect(harness.criticCalls).toBe(2);
    const cp = checkpointRow();
    expect(cp.status).toBe('completed');
    expect(cp.snapshot.released).toBe(true);
    expect(harness.writerInputs.length).toBeGreaterThanOrEqual(2);
    const rerouted = harness.writerInputs[harness.writerInputs.length - 1] ?? '';
    expect(rerouted).toContain('final critic block on sections: Rubric table');
    expect(rerouted).not.toContain('internal coverage judgement');
  });

  it('leaves phase 7 resumable when a pause lands mid-route-back, never completed-and-unreleased', async () => {
    const harness = mockDeps([critic('block', { mostDangerousDefect: 'A defect the rewrite would fix.' })]);
    let writerDispatches = 0;
    const deps: EngineDeps = {
      db: harness.deps.db,
      runDispatch: harness.deps.runDispatch,
      preDispatch: (input) => {
        if (input.agent === 'review-report-writer') {
          writerDispatches += 1;
          if (writerDispatches === 2) {
            return { pause: true, reason: 'cost_ceiling' };
          }
        }
        return { pause: false };
      },
    };
    await expect(runPhase7(deps, reviewId)).rejects.toBeInstanceOf(DispatchPauseError);
    const cp = checkpointRow();
    expect(cp.status).toBe('in_progress');
    expect(cp.gate).toBe('block');
  });

  it('seeds the writer with a prior block\'s sections from the surviving checkpoint snapshot, never its prose', async () => {
    sqlite
      .prepare('INSERT INTO phase_checkpoints (id, review_id, phase, status, snapshot_json, fix_cycle_count, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`cp-${reviewId}`, reviewId, 'engine_phase_7', 'pending', JSON.stringify({ released: false, blocked: true, reason: 'PRIOR-BLOCK-REASON about the rubric', sections: ['Rubric table'], fixCycles: 0 }), 0, new Date().toISOString());
    const harness = mockDeps([critic('pass')]);
    await runPhase7(harness.deps, reviewId);
    expect(harness.writerInputs.length).toBeGreaterThanOrEqual(1);
    expect(harness.writerInputs[0]).toContain('a prior run of this gate was blocked by the final critic on sections: Rubric table');
    expect(harness.writerInputs[0]).not.toContain('PRIOR-BLOCK-REASON');
  });

  it('seeds a generic rebuild instruction when the prior block snapshot carries no sections', async () => {
    sqlite
      .prepare('INSERT INTO phase_checkpoints (id, review_id, phase, status, snapshot_json, fix_cycle_count, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`cp-${reviewId}`, reviewId, 'engine_phase_7', 'pending', JSON.stringify({ released: false, blocked: true, reason: 'PRIOR-BLOCK-REASON about the rubric', fixCycles: 0 }), 0, new Date().toISOString());
    const harness = mockDeps([critic('pass')]);
    await runPhase7(harness.deps, reviewId);
    expect(harness.writerInputs[0]).toContain('a prior run of this gate was blocked by the final critic. Rebuild the report');
    expect(harness.writerInputs[0]).not.toContain('PRIOR-BLOCK-REASON');
  });

  it('hands the final critic the field dossier and the structured evidence map', async () => {
    writeArtefact(reviewId, 'p2-context', {
      keyPapers: [{ citation: 'Thomsen, Cowan, & McAdams, 2025, Mental illness and personal recovery', whyItMatters: 'Comparator.' }],
      comparators: [{ citation: 'Anderson, 2024, Executing Psychobiography', relevance: 'Method comparator.' }],
      benchmarks: [],
      contestedClaims: [],
      methodNorms: [],
    });
    const harness = mockDeps([critic('pass')]);
    await runPhase7(harness.deps, reviewId);
    expect(harness.criticInputs).toHaveLength(1);
    const criticInput = harness.criticInputs[0] ?? '';
    expect(criticInput).toContain('Field dossier');
    expect(criticInput).toContain('Thomsen');
    expect(criticInput).toContain('Shipped evidence map');
    expect(criticInput).toContain('The reported mean is impossible.');
    const writerInput = harness.writerInputs[0] ?? '';
    expect(writerInput).toContain('Executing Psychobiography');
  });

  it('routes back a reference found in neither the dossier nor the manuscript, then releases the corrected draft', async () => {
    writeManuscriptBlob(reviewId, 'parse/section-map.json', JSON.stringify({
      title: 'A brief wellbeing trial',
      abstract: 'Abstract text.',
      sections: [{ index: 0, heading: 'Results', text: 'The mean was 8.40.', lineStart: 1, lineEnd: 3 }],
      references: [{ index: 0, raw: 'Suleiman-Martos, N., et al. (2020). Burnout in nursing.', title: 'Burnout in nursing', doi: null, year: 2020, venue: null, authors: [] }],
      fullText: 'The mean was 8.40.',
      parser: 'grobid',
      parseQuality: 'good',
    }));
    writeArtefact(reviewId, 'p2-context', {
      keyPapers: [{ citation: 'Thomsen, Cowan, & McAdams, 2025, Mental illness and personal recovery', whyItMatters: 'Comparator.' }],
      comparators: [],
      benchmarks: [],
      contestedClaims: [],
      methodNorms: [],
    });
    const base = shippedObject();
    const withGhost = { ...base, references: ['Nowhere, A. B. (2019). A paper that was never retrieved.'] };
    const harness = mockDeps([critic('pass')], undefined, undefined, [withGhost, base]);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.snapshot.released).toBe(true);
    expect(harness.writerInputs.length).toBeGreaterThanOrEqual(2);
    expect(harness.writerInputs[1]).toContain('field dossier');
    expect(harness.writerInputs[1]).toContain('Nowhere');
  });

  // The writer is told the whole dossier is citable, so the checker must accept citations
  // from every dossier section, not only keyPapers and comparators.
  it('accepts a reference sourced from the dossier benchmarks rather than routing it back', async () => {
    writeManuscriptBlob(reviewId, 'parse/section-map.json', JSON.stringify({
      title: 'A brief wellbeing trial',
      abstract: 'Abstract text.',
      sections: [{ index: 0, heading: 'Results', text: 'The mean was 8.40.', lineStart: 1, lineEnd: 3 }],
      references: [{ index: 0, raw: 'Suleiman-Martos, N., et al. (2020). Burnout in nursing.', title: 'Burnout in nursing', doi: null, year: 2020, venue: null, authors: [] }],
      fullText: 'The mean was 8.40.',
      parser: 'grobid',
      parseQuality: 'good',
    }));
    writeArtefact(reviewId, 'p2-context', {
      keyPapers: [],
      comparators: [],
      benchmarks: [{ metric: 'Internal consistency', value: '0.70', source: 'Nunnally & Bernstein, 1994, Psychometric Theory', tension: null }],
      contestedClaims: [],
      methodNorms: [],
    });
    const base = shippedObject();
    const fromBenchmark = { ...base, references: ['Nunnally & Bernstein (1994). Psychometric Theory.'] };
    const harness = mockDeps([critic('pass')], undefined, undefined, [fromBenchmark]);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.snapshot.released).toBe(true);
    expect(harness.criticCalls).toBe(1);
    expect(harness.writerInputs).toHaveLength(1);
  });

  it('id-masks the blocked section labels before they reach the writer or the snapshot', async () => {
    const harness = mockDeps([
      critic('block', { sectionsToRework: ['The unit grounded in REV-SIM-0001'] }),
      critic('pass'),
    ]);
    await runPhase7(harness.deps, reviewId);
    const rerouted = harness.writerInputs[harness.writerInputs.length - 1] ?? '';
    expect(rerouted).toContain('final critic block on sections:');
    expect(rerouted).not.toContain('REV-SIM-0001');
    expect(rerouted).toContain('[EDITOR-ONLY]');
  });

  // GROBID can extract zero references from a clean manuscript. A dossier-only comparison
  // would then call every manuscript-sourced citation fabricated and burn the grounding budget.
  it('skips the citation check entirely when the manuscript reference list failed to parse', async () => {
    writeArtefact(reviewId, 'p2-context', {
      keyPapers: [{ citation: 'Thomsen, Cowan, & McAdams, 2025, Mental illness and personal recovery', whyItMatters: 'Comparator.' }],
      comparators: [],
      benchmarks: [],
      contestedClaims: [],
      methodNorms: [],
    });
    const base = shippedObject();
    const manuscriptSourced = { ...base, references: ['Suleiman-Martos, N., et al. (2020). Burnout in nursing.'] };
    const harness = mockDeps([critic('pass')], undefined, undefined, [manuscriptSourced]);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.snapshot.released).toBe(true);
    expect(harness.criticCalls).toBe(1);
    expect(harness.writerInputs).toHaveLength(1);
  });

  it('id-masks the block reason at capture so the snapshot and terminal events never carry an editor-only id', async () => {
    const harness = mockDeps([
      critic('block', { mostDangerousDefect: 'The notes quote REV-SIM-0001 next to REV-STAT-0001.' }),
      critic('block', { mostDangerousDefect: 'The notes quote REV-SIM-0001 next to REV-STAT-0001.' }),
    ]);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.snapshot.released).toBe(false);
    const reason = String(cp.snapshot.reason);
    expect(reason).toContain('[EDITOR-ONLY]');
    expect(reason).not.toContain('REV-SIM-0001');
    expect(reason).toContain('REV-STAT-0001');
  });

  it('stamps the gate-block terminal with its error class', async () => {
    const harness = mockDeps([critic('block'), critic('block')]);
    await runPhase7(harness.deps, reviewId);
    const terminal = sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'run_terminal' ORDER BY seq DESC LIMIT 1")
      .get(reviewId) as { payload_json: string };
    expect(JSON.parse(terminal.payload_json).errorClass).toBe('release_gate_block');
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
    // The deterministic rewrites are spent, so the confidentiality audit runs once on the
    // last body before arbitration decides. The release outcome below is unchanged.
    expect(harness.criticCalls).toBe(1);
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
    // The deterministic rewrites are spent, so the confidentiality audit runs once on the
    // last body before arbitration decides. The release outcome below is unchanged.
    expect(harness.criticCalls).toBe(1);
    expect(checkpointRow().snapshot.released).toBe(false);
    expect(harness.writerInputs.length).toBeGreaterThanOrEqual(2);
    expect(harness.writerInputs[1]).toContain('id-free');
  });

  it('humanises an inline enum token so the review ships instead of routing back', async () => {
    const withTokens = {
      ...shippedObject(),
      bodyMarkdown: `${shippedObject().bodyMarkdown}\n\nThe category should fall to major_revision if unresolved.`,
    };
    const harness = mockDeps([critic('pass')], withTokens);
    await runPhase7(harness.deps, reviewId);
    expect(harness.criticCalls).toBe(1);
    expect(checkpointRow().snapshot.released).toBe(true);
    const shipped = readArtefact<{ bodyMarkdown: string }>(reviewId, 'p7-shipped-final');
    expect(shipped.bodyMarkdown).toContain('major revision');
    expect(shipped.bodyMarkdown).not.toContain('major_revision');
  });

  it('auto-scrubs a structured decision line so the review ships instead of routing back', async () => {
    const withDecisionLine = {
      ...shippedObject(),
      bodyMarkdown: `${shippedObject().bodyMarkdown}\n\n- Decision: major_revision`,
    };
    const harness = mockDeps([critic('pass')], withDecisionLine);
    await runPhase7(harness.deps, reviewId);
    expect(harness.criticCalls).toBe(1);
    expect(checkpointRow().snapshot.released).toBe(true);
  });

  // A short body spent both deterministic rewrites on the word band, which used to end the loop
  // before the critic ran, so a review reached its authors with the confidentiality audit skipped.
  it('audits confidentiality even when the deterministic rewrites are spent, and a block still stops the release', async () => {
    const base = shippedObject();
    const short = {
      ...base,
      bodyMarkdown: [
        'Dear Editor and Authors, I recommend major revision, and I hold this with moderate confidence.',
        `**The reported mean is impossible.** ${HUMANISED[0]}`,
        `**Sampling is under-described.** ${HUMANISED[1]}`,
        HUMANISED[2],
        narrativeFiller(400),
      ].join('\n\n'),
    };
    const harness = mockDeps(
      [critic('block', { mostDangerousDefect: 'The rubric exposes an editor-only coverage judgement to the authors.' })],
      short,
    );
    await runPhase7(harness.deps, reviewId);

    expect(harness.criticCalls).toBe(1);
    const cp = checkpointRow();
    expect(cp.gate).toBe('block');
    expect(eventKinds()).not.toContain('arbitration');
    const review = sqlite.prepare('SELECT status FROM reviews WHERE id = ?').get(reviewId) as { status: string };
    expect(review.status).toBe('failed');
    const deliverableCount = (sqlite.prepare('SELECT count(*) AS n FROM deliverables WHERE review_id = ?').get(reviewId) as { n: number }).n;
    expect(deliverableCount).toBe(0);
  });

  it('ships via arbitration on an unresolvable cosmetic trope instead of destroying the review', async () => {
    const trope = '\n\nThe contribution is not only strong but also genuinely valuable here.';
    const base = shippedObject();
    const tropeMajor = { ...base, bodyMarkdown: `${base.bodyMarkdown}${trope}` };
    const tropeNarrowed = { ...base, recommendation: 'reject_and_resubmit', bodyMarkdown: `${base.bodyMarkdown}${trope}` };
    const harness = mockDeps([critic('pass')], undefined, undefined, [tropeMajor, tropeMajor, tropeNarrowed]);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.snapshot.released).toBe(true);
    expect(cp.gate).toBe('arbitrated');
    // The deterministic rewrites are spent, so the confidentiality audit runs once on the
    // last body before arbitration decides. The release outcome below is unchanged.
    expect(harness.criticCalls).toBe(1);
    const review = sqlite.prepare('SELECT recommendation FROM reviews WHERE id = ?').get(reviewId) as { recommendation: string };
    expect(review.recommendation).toBe('reject_and_resubmit');
  });

  it('falls back to the pre-alignment report when the narrowed rewrite introduces a substantive defect, never losing the review', async () => {
    const trope = '\n\nThe contribution is not only strong but also genuinely valuable here.';
    const base = shippedObject();
    const tropeMajor = { ...base, bodyMarkdown: `${base.bodyMarkdown}${trope}` };
    const alignedBadId = {
      ...base,
      recommendation: 'reject_and_resubmit',
      bodyMarkdown: `${base.bodyMarkdown}\n\nSee REV-STAT-0001 in the record.`,
    };
    const harness = mockDeps([critic('pass')], undefined, undefined, [tropeMajor, tropeMajor, alignedBadId]);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.snapshot.released).toBe(true);
    const review = sqlite.prepare('SELECT status, recommendation FROM reviews WHERE id = ?').get(reviewId) as { status: string; recommendation: string };
    expect(review.status).not.toBe('failed');
    expect(review.recommendation).toBe('major_revision');
    const fallback = sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'arbitration' AND payload_json LIKE '%alignment-fallback%'")
      .get(reviewId) as { payload_json: string } | undefined;
    expect(fallback).toBeDefined();
    const shipped = readArtefact<{ bodyMarkdown: string }>(reviewId, 'p7-shipped-final');
    expect(shipped.bodyMarkdown).not.toContain('REV-STAT-0001');
  });

  it('routes back an evidence map whose labels are missing from the body', async () => {
    const brokenMap = { ...shippedObject(), bodyMarkdown: 'Dear Editor and Authors, I recommend major revision.' };
    const harness = mockDeps([critic('pass')], brokenMap);
    await runPhase7(harness.deps, reviewId);
    // The deterministic rewrites are spent, so the confidentiality audit runs once on the
    // last body before arbitration decides. The release outcome below is unchanged.
    expect(harness.criticCalls).toBe(1);
    expect(checkpointRow().snapshot.released).toBe(false);
    expect(harness.writerInputs[1]).toContain('evidence map');
  });

  it('repairs a paraphrased evidence label from its section heading', async () => {
    const paraphrased = {
      ...shippedObject(),
      bodyMarkdown: `${shippedObject().bodyMarkdown}\n\n## 4B. By-section review\n### ACT in the workplace\nThe framing outstrips the design.`,
      evidenceMap: [
        ...shippedObject().evidenceMap,
        {
          section: '4B ACT in the workplace',
          label: 'Specifying psychological flexibility sub-processes.',
          anchor: 'Section 1.2',
          findingIds: ['REV-STAT-0002'],
        },
      ],
    };
    const harness = mockDeps([critic('pass')], paraphrased);
    await runPhase7(harness.deps, reviewId);
    expect(checkpointRow().snapshot.released).toBe(true);
    const final = readArtefact<{ evidenceMap: Array<{ section: string; label: string }> }>(reviewId, 'p7-shipped-final');
    const repaired = final.evidenceMap.find((entry) => entry.section === '4B ACT in the workplace');
    expect(repaired?.label).toBe('ACT in the workplace');
  });

  it('repairs a near-miss label through token overlap with a body heading', async () => {
    const nearMiss = {
      ...shippedObject(),
      bodyMarkdown: `${shippedObject().bodyMarkdown}\n\n### Outcomes, processes, and statistical analyses\nDetail follows.`,
      evidenceMap: [
        ...shippedObject().evidenceMap,
        {
          section: '4B Outcomes',
          label: 'Outcomes and processes and statistical analyses',
          anchor: 'Section 3',
          findingIds: ['REV-METH-0001'],
        },
      ],
    };
    const harness = mockDeps([critic('pass')], nearMiss);
    await runPhase7(harness.deps, reviewId);
    expect(checkpointRow().snapshot.released).toBe(true);
    const final = readArtefact<{ evidenceMap: Array<{ section: string; label: string }> }>(reviewId, 'p7-shipped-final');
    expect(final.evidenceMap.find((entry) => entry.section === '4B Outcomes')?.label).toBe(
      'Outcomes, processes, and statistical analyses',
    );
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
    const alignmentInput = JSON.parse(harness.writerInputs[harness.writerInputs.length - 1] ?? '{}') as {
      parts?: { prompt?: string };
    };
    const userPrompt = alignmentInput.parts?.prompt ?? '';
    expect(userPrompt).toContain('reject and resubmit');
    expect(userPrompt.includes('reject_and_resubmit')).toBe(false);
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

  it('falls back to the pre-alignment report when the narrowed rewrite cannot be produced, never losing the review', async () => {
    const harness = mockDeps([critic('revise'), critic('revise')]);
    await runPhase7(harness.deps, reviewId);
    const cp = checkpointRow();
    expect(cp.snapshot.released).toBe(true);
    const review = sqlite.prepare('SELECT status, recommendation FROM reviews WHERE id = ?').get(reviewId) as { status: string; recommendation: string };
    expect(review.status).not.toBe('failed');
    expect(review.recommendation).toBe('major_revision');
    const alignEvents = sqlite
      .prepare("SELECT payload_json FROM review_events WHERE review_id = ? AND kind = 'gate_verdict'")
      .all(reviewId)
      .map((row) => JSON.parse((row as { payload_json: string }).payload_json) as { source: string; verdict: string });
    expect(alignEvents.some((event) => event.source === 'arbitration-alignment' && event.verdict === 'aligned-fallback')).toBe(true);
    expect(alignEvents.some((event) => event.source === 'arbitration-alignment' && event.verdict === 'block')).toBe(false);
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

  // The released letter justified a low transparency score with an editor-only coverage
  // finding, because the meta rubric named it as supporting evidence and only the id was masked.
  it('withholds editor-only ids from the rubric support and decision hinges the writer receives', async () => {
    const meta = metaObject();
    meta.rubric[11] = { criterion: 12, score: 2, supportingIds: ['REV-STAT-0001', 'REV-SIM-0001'], opposingIds: ['REV-SIM-0001'] };
    meta.decisionHinges = [
      { findingId: 'REV-STAT-0001', hinge: 'Until resolved, cannot advance beyond major revision.' },
      { findingId: 'REV-SIM-0001', hinge: 'The overlap signal has to be checked before acceptance.' },
    ];
    const harness = mockDeps([critic('pass')], undefined, [meta]);
    await runPhase7(harness.deps, reviewId);

    expect(harness.writerInputs.length).toBeGreaterThanOrEqual(1);
    for (const raw of harness.writerInputs) {
      const pkg = JSON.parse(raw) as { parts: { prompt?: string } };
      const seen = pkg.parts.prompt ?? '';
      const start = seen.indexOf('Recommendation package');
      const end = seen.indexOf('Swarm report critique', start);
      const block = seen.slice(start, end === -1 ? undefined : end);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      expect(block).not.toContain('REV-SIM-0001');
      expect(block).not.toContain('[EDITOR-ONLY]');
      expect(block).not.toContain('overlap signal has to be checked');
      expect(block).toContain('REV-STAT-0001');
    }
  });

  // Masking ids is not enough on its own: the confidential section's prose survived id
  // redaction and reached the author letter as an established author omission.
  it('never shows the confidential editor-only prose to the writer, while the critic still audits it', async () => {
    writeArtefact(reviewId, 'p6-report', {
      mode: 'A',
      bodyMarkdown: [
        '# Peer Review Report',
        '',
        '## 7. What I require in a revised submission',
        '',
        'Report the versioned computational record, grounded in REV-STAT-0001.',
        '',
        '## 8. Confidential editor-only note',
        '',
        'A weak stylometric signal appears in the prose, and a full similarity screen was unavailable.',
        'The lack of a direct analysis-code path should be checked before it is treated as an author omission.',
        '',
        '## 9. Closing',
        '',
        'There is a good paper within reach here.',
      ].join('\n'),
    });
    const harness = mockDeps([critic('pass')]);
    await runPhase7(harness.deps, reviewId);

    expect(harness.writerInputs.length).toBeGreaterThanOrEqual(1);
    for (const input of harness.writerInputs) {
      // The section heading itself is named by the knowledge/05 template in every prompt,
      // so the assertion targets the confidential substance the strip has to remove.
      expect(input).not.toContain('stylometric');
      expect(input).not.toContain('similarity screen');
      expect(input).not.toContain('analysis-code path');
      expect(input).toContain('There is a good paper within reach here.');
      expect(input).toContain('Report the versioned computational record');
    }

    expect(harness.criticInputs).toHaveLength(1);
    expect(harness.criticInputs[0]).toContain('stylometric');
    expect(harness.criticInputs[0]).toContain('analysis-code path');

    expect(harness.swarmInputs.length).toBeGreaterThanOrEqual(1);
    for (const input of harness.swarmInputs) {
      expect(input).not.toContain('stylometric');
      expect(input).not.toContain('similarity screen');
      expect(input).toContain('There is a good paper within reach here.');
    }

    const gateRecord = readArtefact<{ strippedEditorOnlySections: string[] }>(reviewId, 'p7-gate-record');
    expect(gateRecord.strippedEditorOnlySections).toEqual(['8. Confidential editor-only note']);
  });
});
