import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Finding } from '@mara/shared';
import { createDb, type MaraDatabase, type SqliteConnection } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { getEvidenceData } from '../../data/evidence';
import { mergeFindings } from '../../ledger';
import { blobDir } from '../../paths';
import type { DispatchInput, DispatchResult } from '../../providers/dispatch';
import { writeManuscriptBlob } from '../../workflow/storage';
import { artefactExists, readArtefact, writeArtefact } from '../artefacts';
import type { EngineDeps } from '../phases-shared';
import { runPhase7 } from '../phase7';

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

function seedLedger(): void {
  mergeFindings(db, {
    reviewId,
    lensPrefix: 'STAT',
    phase: 'phase_3',
    agent: 'specialist-reviewer',
    fragments: [finding({ claim: 'Impossible mean.' })],
  });
  mergeFindings(db, {
    reviewId,
    lensPrefix: 'SIM',
    phase: 'phase_4',
    agent: 'integrity-screener',
    fragments: [finding({ lens: 'similarity', claim: 'Overlap signal.', scope: 'editor-only' })],
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
    rubric: Array.from({ length: 15 }, (_unused, index) => ({ criterion: index + 1, score: 3, supportingIds: ['REV-STAT-0001'], opposingIds: [] })),
    average: 3.0,
    bottlenecks: [4, 5, 9],
    recommendation: 'major_revision',
    recommendationConfidence: 0.8,
    scopeFit: { score: 0.7, factorsUsed: ['topic-fit'] },
    decisionHinges: [{ findingId: 'REV-STAT-0001', hinge: 'Until resolved, cannot advance beyond major revision.' }],
    editorSummaryMarkdown: 'The decision rests on REV-STAT-0001.',
    selfCritique,
  };
}

function shippedObject() {
  return {
    mode: 'B',
    recommendation: 'major_revision',
    recommendationConfidence: 0.8,
    bodyMarkdown: ['Dear Editor and Authors, I recommend major revision, held with moderate confidence.', '**The reported mean is impossible.** Table 2 reports a value outside the scale range.'].join('\n\n'),
    evidenceMap: [{ section: '4A.1', label: 'The reported mean is impossible.', anchor: 'Table 2', findingIds: ['REV-STAT-0001'] }],
    rubricTable: Array.from({ length: 15 }, (_unused, index) => ({ criterion: index + 1, score: 3, justification: 'Grounded in the ledger.' })),
    references: [],
    citedFindingIds: ['REV-STAT-0001'],
    editorOnlyLeak: false,
    humanizePairs: [{ before: 'a', after: 'b' }, { before: 'c', after: 'd' }, { before: 'e', after: 'f' }],
    selfCritique,
  };
}

function priorStressObject(hinges: string[]) {
  return {
    caseFor: 'The evidence supports a revise outcome consistent with the prior.',
    caseAgainst: 'The statistical concern could be deeper than a routine revision assumes, and REV-SIM-0001 also cuts against it.',
    alignment: 'partially_supported',
    hingeFindingIds: hinges,
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

function mockDeps(priorHinges: string[]): { deps: EngineDeps; agents: string[]; priorStressPrompts: string[] } {
  const agents: string[] = [];
  const priorStressPrompts: string[] = [];
  const runDispatch = async (input: DispatchInput): Promise<DispatchResult> => {
    agents.push(input.agent);
    switch (input.agent) {
      case 'review-meta-reviewer':
        return successResult(metaObject());
      case 'swarm':
        return successResult({ mode: 'B', critique: [], selfCritique });
      case 'review-report-writer':
        return successResult(shippedObject());
      case 'review-final-critic':
        return successResult({ verdict: 'pass', lens: null, sectionsToRework: [], findingIdToSupersede: null, failureConstructionAttempt: 'I tried.', escalatedInconsistencies: [], mostDangerousDefect: null, selfCritique });
      case 'prior-stress-test':
        priorStressPrompts.push(String(input.parts.prompt));
        return successResult(priorStressObject(priorHinges));
      default:
        throw new Error(`unexpected agent ${input.agent}`);
    }
  };
  return { deps: { db, runDispatch }, agents, priorStressPrompts };
}

function seedReview(answers: Record<string, unknown>): void {
  const now = new Date().toISOString();
  sqlite
    .prepare('INSERT INTO reviews (id, slug, status, options_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(reviewId, reviewId, 'running', JSON.stringify({ preset: 'fast', answers }), now, now);
  seedLedger();
  seedContext();
}

function checkpointStatus(): string | undefined {
  const row = sqlite.prepare('SELECT status FROM phase_checkpoints WHERE review_id = ? AND phase = ?').get(reviewId, 'engine_phase_7') as { status: string } | undefined;
  return row?.status;
}

function errorEvents(): number {
  return (sqlite.prepare("SELECT count(*) AS n FROM review_events WHERE review_id = ? AND kind = 'error'").get(reviewId) as { n: number }).n;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-intake-p7-'));
  const client = createDb(join(tempDir, 'mara.db'));
  db = client.db;
  sqlite = client.sqlite;
  runMigrations(db);
  reviewId = `ip7-${Date.now()}-${Math.random().toString(36).slice(2)}`;
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(blobDir(reviewId), { recursive: true, force: true });
});

describe('phase 7 prior stress test', () => {
  it('does not dispatch the stress test when no prior is set', async () => {
    seedReview({ journal: 'PLOS ONE' });
    const h = mockDeps(['REV-STAT-0001']);
    await runPhase7(h.deps, reviewId);
    expect(h.agents).not.toContain('prior-stress-test');
    expect(artefactExists(reviewId, 'p7-prior-stress')).toBe(false);
    expect(getEvidenceData(db, reviewId).priorStressTest).toBeNull();
  });

  it('dispatches when a prior is set, embeds the notes section, and serves the panel with author-facing hinges only', async () => {
    seedReview({ journal: 'PLOS ONE', userPrior: 'major-revision' });
    const h = mockDeps(['REV-STAT-0001', 'REV-SIM-0001']);
    await runPhase7(h.deps, reviewId);

    expect(h.agents.filter((agent) => agent === 'prior-stress-test')).toHaveLength(1);
    expect(artefactExists(reviewId, 'p7-prior-stress')).toBe(true);
    expect(checkpointStatus()).toBe('completed');

    const notes = readArtefact<{ markdown: string }>(reviewId, 'p7-private-notes-final').markdown;
    expect(notes).toContain('## Preliminary assessment, stress-tested');
    expect(notes).toContain('Major revision');

    const panel = getEvidenceData(db, reviewId).priorStressTest;
    expect(panel).not.toBeNull();
    expect(panel?.prior).toBe('major-revision');
    expect(panel?.alignment).toBe('partially_supported');
    expect(panel?.hingeFindingIds).toEqual(['REV-STAT-0001']);
  });

  it('keeps editor-only content out of the stress-test input and redacts leaked ids from the served prose', async () => {
    seedReview({ journal: 'PLOS ONE', userPrior: 'major-revision' });
    const h = mockDeps(['REV-STAT-0001']);
    await runPhase7(h.deps, reviewId);

    const prompt = h.priorStressPrompts[0] ?? '';
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).not.toContain('REV-SIM-0001');
    expect(prompt).not.toContain('Overlap signal.');

    const evidence = getEvidenceData(db, reviewId);
    expect(evidence.priorStressTest?.caseAgainst).not.toContain('REV-SIM-0001');
    expect(evidence.priorStressTest?.caseAgainst).toContain('[EDITOR-ONLY]');
    expect(JSON.stringify({ ...evidence, editorOnly: undefined })).not.toContain('REV-SIM-0001');
    expect(evidence.editorOnly.map((finding) => finding.id)).toEqual(['REV-SIM-0001']);
  });

  it('logs an error and still releases when the stress test cites an ungrounded hinge', async () => {
    seedReview({ journal: 'PLOS ONE', userPrior: 'reject' });
    const h = mockDeps(['REV-NOPE-9999']);
    await runPhase7(h.deps, reviewId);

    expect(artefactExists(reviewId, 'p7-prior-stress')).toBe(false);
    expect(errorEvents()).toBeGreaterThanOrEqual(1);
    expect(checkpointStatus()).toBe('completed');
    expect(getEvidenceData(db, reviewId).priorStressTest).toBeNull();
  });
});
