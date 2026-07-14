import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Finding } from '@mara/shared';
import { createDb, type MaraDatabase, type SqliteConnection } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { mergeFindings } from '../../ledger';
import { blobDir } from '../../paths';
import type { DispatchInput, DispatchResult } from '../../providers/dispatch';
import { manuscriptBlobPath, writeManuscriptBlob } from '../../workflow/storage';
import { writeArtefact } from '../artefacts';
import type { EngineDeps } from '../phases-shared';
import { runPhase7 } from '../phase7';
import { runPhase8 } from '../phase8';

let tempDir: string;
let db: MaraDatabase;
let sqlite: SqliteConnection;
let reviewId: string;

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

const selfCritique = { strongestObjection: 'Mock output; not derived from evidence.', confidenceRaisers: ['A real dispatch'] };

function metaObject() {
  return {
    rubric: Array.from({ length: 15 }, (_u, index) => ({ criterion: index + 1, score: 3, supportingIds: ['REV-STAT-0001'], opposingIds: [] })),
    average: 3.0,
    bottlenecks: [4, 5, 9],
    recommendation: 'major_revision',
    recommendationConfidence: 0.8,
    scopeFit: { score: 0.7, factorsUsed: ['topic-fit'] },
    decisionHinges: [{ findingId: 'REV-STAT-0001', hinge: 'Cannot advance beyond major revision until resolved.' }],
    editorSummaryMarkdown: 'The decision rests on REV-STAT-0001; the strongest alternative reading holds that the effect survives.',
    selfCritique,
  };
}

function shippedObject() {
  return {
    mode: 'B',
    recommendation: 'major_revision',
    recommendationConfidence: 0.8,
    bodyMarkdown:
      '# 1. Brief overview\n**The central statistical concern.** Table 2 reports a mean above the scale ceiling.\n\n## 2. Overall recommendation\nI recommend major revision.',
    evidenceMap: [
      {
        section: '4A.1',
        label: 'The central statistical concern.',
        anchor: 'Table 2',
        findingIds: ['REV-STAT-0001', 'REV-METH-0001'],
      },
    ],
    rubricTable: Array.from({ length: 15 }, (_u, index) => ({ criterion: index + 1, score: 3, justification: 'Grounded.' })),
    references: [],
    citedFindingIds: ['REV-STAT-0001', 'REV-METH-0001'],
    editorOnlyLeak: false,
    humanizePairs: [
      { before: 'a', after: 'b' },
      { before: 'c', after: 'd' },
      { before: 'e', after: 'f' },
    ],
    selfCritique,
  };
}

function qualityObject() {
  return {
    evidenceGroundingRate: 0.9,
    actionabilityIndex: 0.8,
    decisionStability: 0.7,
    toneRiskScore: 0.1,
    unsupportedClaimCount: 1,
    weights: { evidenceGroundingRate: 0.3, actionabilityIndex: 0.25, decisionStability: 0.2, toneRiskScore: 0.15, unsupportedClaimPenalty: 0.1 },
    composite: 0.82,
    selfCritique,
  };
}

function scopeObject() {
  return { score: 0.72, factorsUsed: ['topic-fit'], confidence: 0.6, scopeTextAvailable: false, noveltyPenaltyApplied: false, rationale: 'Topic fits the journal aims.', selfCritique };
}

function calibrationObject() {
  return { mode: 'cross-journal-fallback', completedReviewsForJournal: 0, journalSpecificThresholdMet: false, benchmarkComparison: 'In line with cross-journal benchmarks.', drift: [], selfCritique };
}

function criticPass() {
  return {
    verdict: 'pass',
    lens: null,
    sectionsToRework: [],
    findingIdToSupersede: null,
    failureConstructionAttempt: 'I could not build a failing input.',
    escalatedInconsistencies: [],
    mostDangerousDefect: null,
    selfCritique,
  };
}

function deps(): EngineDeps {
  const runDispatch = async (input: DispatchInput): Promise<DispatchResult> => {
    const object = ({
      'review-meta-reviewer': metaObject(),
      swarm: { mode: 'B', critique: [], selfCritique },
      'review-report-writer': shippedObject(),
      'review-final-critic': criticPass(),
      'quality-metrics-engine': qualityObject(),
      'journal-scope-scorer': scopeObject(),
      'review-calibrator': calibrationObject(),
    } as Record<string, unknown>)[input.agent];
    if (object === undefined) {
      throw new Error(`unexpected agent ${input.agent}`);
    }
    return {
      dispatchId: 'mock',
      provider: 'anthropic',
      model: 'mock',
      status: 'success',
      object,
      tokens: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, reasoningTokens: 0 },
      latencyMs: 1,
      langfuseTraceId: null,
      replayed: false,
    };
  };
  return { db, runDispatch };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-p8-'));
  const client = createDb(join(tempDir, 'mara.db'));
  db = client.db;
  sqlite = client.sqlite;
  runMigrations(db);
  reviewId = `p8-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  sqlite
    .prepare('INSERT INTO reviews (id, slug, status, options_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(reviewId, reviewId, 'running', JSON.stringify({ preset: 'fast', answers: { journal: 'PLOS ONE', field: 'wellbeing science' } }), now, now);
  mergeFindings(db, { reviewId, lensPrefix: 'STAT', phase: 'phase_3', agent: 'specialist-reviewer', fragments: [finding({})] });
  mergeFindings(db, { reviewId, lensPrefix: 'METH', phase: 'phase_3', agent: 'specialist-reviewer', fragments: [finding({ lens: 'methods' })] });
  mergeFindings(db, { reviewId, lensPrefix: 'SIM', phase: 'phase_4', agent: 'integrity-screener', fragments: [finding({ lens: 'similarity', scope: 'editor-only', claim: 'Overlap signal.' })] });
  const sectionMap = {
    title: 'A brief wellbeing trial',
    abstract: 'Abstract.',
    sections: [{ index: 0, heading: 'Results', text: 'Mean 8.40.', lineStart: 1, lineEnd: 2 }],
    references: [],
    fullText: 'Mean 8.40.',
    parser: 'grobid',
    parseQuality: 'good',
  };
  writeManuscriptBlob(reviewId, 'parse/section-map.json', JSON.stringify(sectionMap));
  writeArtefact(reviewId, 'p6-report', { mode: 'A', bodyMarkdown: 'Full internal report referencing REV-STAT-0001.' });
  writeArtefact(reviewId, 'p5-swarm', { mode: 'A', decisionStability: 0.7, strongestMinorityReport: 'A minority position.' });
  writeArtefact(reviewId, 'p1-analyst-b', { studyDesign: 'randomized-trial' });
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(blobDir(reviewId), { recursive: true, force: true });
});

describe('phase 8 production and close-out', () => {
  it('generates valid branded docx deliverables and records released rows', async () => {
    await runPhase7(deps(), reviewId);
    await runPhase8(deps(), reviewId);

    const rows = sqlite
      .prepare('SELECT kind, format, path, released, length(checksum) AS checksumLen FROM deliverables WHERE review_id = ? ORDER BY kind, format')
      .all(reviewId) as Array<{ kind: string; format: string; path: string; released: number; checksumLen: number }>;
    const keys = rows.map((row) => `${row.kind}:${row.format}`);
    expect(keys).toContain('peer_review_report:docx');
    expect(keys).toContain('reviewer_private_notes:docx');
    expect(keys).toContain('ledger_export:md');
    expect(rows.every((row) => row.released === 1)).toBe(true);
    expect(rows.every((row) => row.checksumLen === 64)).toBe(true);

    const docxPath = manuscriptBlobPath(reviewId, 'output/author-letter.docx');
    expect(existsSync(docxPath)).toBe(true);
    const zip = await JSZip.loadAsync(readFileSync(docxPath));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Inter');
    expect(xml).toContain('JetBrains Mono');
    expect(xml).toContain('006D7C');

    const notesPath = manuscriptBlobPath(reviewId, 'output/reviewer-private-notes.docx');
    expect(existsSync(notesPath)).toBe(true);

    expect(existsSync(manuscriptBlobPath(reviewId, 'report/full-report.md'))).toBe(true);
    expect(existsSync(manuscriptBlobPath(reviewId, 'memory/lessons.json'))).toBe(true);
  });

  it('excludes editor-only ids from the author-facing docx', async () => {
    await runPhase7(deps(), reviewId);
    await runPhase8(deps(), reviewId);
    const zip = await JSZip.loadAsync(readFileSync(manuscriptBlobPath(reviewId, 'output/author-letter.docx')));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).not.toContain('REV-SIM-0001');
  });

  it('completes the review and records the phase 8 checkpoint with the composite', async () => {
    await runPhase7(deps(), reviewId);
    await runPhase8(deps(), reviewId);
    const review = sqlite.prepare('SELECT status FROM reviews WHERE id = ?').get(reviewId) as { status: string };
    expect(review.status).toBe('completed');
    const cp = sqlite
      .prepare("SELECT status, snapshot_json FROM phase_checkpoints WHERE review_id = ? AND phase = 'engine_phase_8'")
      .get(reviewId) as { status: string; snapshot_json: string };
    expect(cp.status).toBe('completed');
    expect((JSON.parse(cp.snapshot_json) as { composite: number }).composite).toBe(0.82);
  });

  it('is idempotent on re-entry and does not duplicate deliverable rows', async () => {
    await runPhase7(deps(), reviewId);
    await runPhase8(deps(), reviewId);
    await runPhase8(deps(), reviewId);
    const count = (sqlite.prepare('SELECT count(*) AS n FROM deliverables WHERE review_id = ?').get(reviewId) as { n: number }).n;
    expect(count).toBe(5);
  });
});
