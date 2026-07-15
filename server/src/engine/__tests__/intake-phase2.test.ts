import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MaraDatabase, type SqliteConnection } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import type { CitationClient, Reference, VerifyReferenceResult } from '../../citations';
import { OPENALEX_HOST } from '../../citations';
import type { FetchLike, HttpResponse } from '../../citations/types';
import { getCurrentFindings } from '../../ledger';
import { blobDir } from '../../paths';
import { createEgressController } from '../../security';
import type { DispatchInput, DispatchResult } from '../../providers/dispatch';
import { writeManuscriptBlob } from '../../workflow/storage';
import { readArtefact, writeArtefact } from '../artefacts';
import type { EngineDeps } from '../phases-shared';
import { runPhase2 } from '../phases';

let tempDir: string;
let db: MaraDatabase;
let sqlite: SqliteConnection;
let reviewId: string;

const selfCritique = { strongestObjection: 'Mock output; not derived from evidence.', confidenceRaisers: ['A real dispatch'] };

function refFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'REV-REF-0001',
    lens: 'REV-REF',
    phase: 2,
    claim: 'The cited source does not support the claim at the written strength.',
    anchor: 'Discussion, para 2',
    epistemic: 'Known',
    confidence: 0.9,
    band: 'Yellow',
    severity: 'moderate',
    fixability: 'easy',
    scope: 'author-facing',
    failureScenario: 'An overclaim inflates the evidence base.',
    leanestFix: 'Reword to match the source.',
    supersedes: null,
    ...overrides,
  };
}

function offlineDossier(): Record<string, unknown> {
  return {
    queryVocabulary: [],
    retrievalLog: [{ query: 'offline', source: 'openalex', date: '2026-07-15', resultsReviewed: 0, resultsIncluded: 0, rationale: 'No web retrieval.' }],
    comparators: [],
    keyPapers: [],
    contestedClaims: [],
    recentReviews: [],
    methodNorms: [],
    gapMap: 'Offline.',
    biasStatement: 'Offline.',
    benchmarks: [],
    sourceAvailability: [],
    findings: [],
    selfCritique,
  };
}

function citationDefault(withFinding: boolean): Record<string, unknown> {
  return {
    samplingStrategy: 'All references.',
    totalCoverage: 1,
    verifications: [
      { referenceIndex: 0, citation: 'The intervention doubled wellbeing scores.', toolsChecked: ['crossref'], classification: 'confirmed', supportNote: null },
      { referenceIndex: 1, citation: 'PsyCap increases performance.', toolsChecked: ['crossref'], classification: 'confirmed', supportNote: null },
    ],
    weakSourceFlags: [],
    hygieneFindings: [],
    findings: withFinding ? [refFinding()] : [],
    selfCritique,
  };
}

function citationClaims(): Record<string, unknown> {
  return {
    assessments: [
      { referenceTitle: 'Brief mindfulness and student wellbeing', claim: 'The intervention doubled wellbeing scores.', support: 'does_not_support', note: 'The abstract reports a small association.' },
      { referenceTitle: 'Psychological capital and performance', claim: 'PsyCap increases performance.', support: 'abstract_unavailable', note: 'No abstract was retrievable.' },
    ],
    findings: [refFinding({ id: 'REV-REF-0002', claim: 'The abstract contradicts the doubling claim.', supersedes: 'REV-REF-0001' })],
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
  order: string[];
  claimsPrompts: string[];
  verifyCalls: number;
}

function harness(opts: { withEgress?: boolean; failDoi?: string } = {}): Harness {
  const order: string[] = [];
  const claimsPrompts: string[] = [];
  const state = { verifyCalls: 0 };

  const runDispatch = async (input: DispatchInput): Promise<DispatchResult> => {
    const prompt = String(input.parts.prompt);
    if (input.agent === 'field-context-scout') {
      order.push('scout');
      return successResult(offlineDossier());
    }
    if (input.agent === 'citation-auditor') {
      if (prompt.includes('Mode: claims')) {
        order.push('citation-claims');
        claimsPrompts.push(prompt);
        return successResult(citationClaims());
      }
      order.push('citation');
      return successResult(citationDefault(true));
    }
    if (input.agent === 'phase-critic') {
      order.push('phase-critic');
      return successResult({ verdict: 'clean', defects: [], strongestGap: 'No material gap.', selfCritique });
    }
    throw new Error(`unexpected agent ${input.agent}`);
  };

  const citationClient: CitationClient = {
    verifyReference: async (reference: Reference): Promise<VerifyReferenceResult> => {
      state.verifyCalls += 1;
      const doi = reference.doi ?? '';
      return { status: 'verified', source: 'crossref', confidence: 0.95, matchedDoi: doi };
    },
    close: () => {},
  };

  let egress: EngineDeps['egress'];
  if (opts.withEgress === true) {
    const baseFetch: FetchLike = async (url): Promise<HttpResponse> => {
      if (url.includes(OPENALEX_HOST) && opts.failDoi !== undefined && url.includes(opts.failDoi)) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (url.includes(OPENALEX_HOST)) {
        return { ok: true, status: 200, json: async () => ({ abstract_inverted_index: { small: [0], association: [1] } }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    egress = createEgressController(baseFetch);
  }

  return {
    deps: { db, runDispatch, citationClient, ...(egress !== undefined ? { egress } : {}) },
    order,
    claimsPrompts,
    get verifyCalls() {
      return state.verifyCalls;
    },
  };
}

function publishedRefs(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_unused, index) => ({
    index,
    raw: `Author ${index} (2024). A published study number ${index}. Journal of Testing.`,
    title: `A published study number ${index} with a sufficiently long title`,
    doi: `10.1000/study-${index}`,
    year: 2024,
    venue: 'Journal of Testing',
    authors: [`Author ${index}`],
  }));
}

function seedReview(preset: string, answers: Record<string, unknown>, referenceCount: number): void {
  const now = new Date().toISOString();
  sqlite
    .prepare('INSERT INTO reviews (id, slug, status, options_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(reviewId, reviewId, 'running', JSON.stringify({ preset, answers }), now, now);
  const sectionMap = {
    title: 'A brief wellbeing trial',
    abstract: 'A short abstract.',
    sections: [{ index: 0, heading: 'Discussion', text: 'The intervention worked.', lineStart: 1, lineEnd: 3 }],
    references: publishedRefs(referenceCount),
    fullText: 'The intervention worked.',
    parser: 'grobid',
    parseQuality: 'good',
  };
  writeManuscriptBlob(reviewId, 'parse/section-map.json', JSON.stringify(sectionMap));
  writeArtefact(reviewId, 'p1-analyst-b', { claimEvidenceMatrix: [] });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-intake-p2-'));
  const client = createDb(join(tempDir, 'mara.db'));
  db = client.db;
  sqlite = client.sqlite;
  runMigrations(db);
  reviewId = `ip2-${Date.now()}-${Math.random().toString(36).slice(2)}`;
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(blobDir(reviewId), { recursive: true, force: true });
});

describe('phase 2 reference audit mode', () => {
  it('standard mode caps verification at twenty and records the dropped references', async () => {
    seedReview('fast', { referenceAudit: 'standard' }, 22);
    const h = harness();
    await runPhase2(h.deps, reviewId);
    expect(h.verifyCalls).toBe(20);
    const artefact = readArtefact<{ clientVerdicts: unknown[]; referencesSkipped: unknown[] }>(reviewId, 'p2-citations');
    expect(artefact.clientVerdicts).toHaveLength(20);
    expect(artefact.referencesSkipped).toHaveLength(2);
  });

  it('forensic mode removes the cap and skips nothing', async () => {
    seedReview('fast', { referenceAudit: 'forensic' }, 22);
    const h = harness();
    await runPhase2(h.deps, reviewId);
    expect(h.verifyCalls).toBe(22);
    const artefact = readArtefact<{ clientVerdicts: unknown[]; referencesSkipped: unknown[] }>(reviewId, 'p2-citations');
    expect(artefact.clientVerdicts).toHaveLength(22);
    expect(artefact.referencesSkipped).toHaveLength(0);
  });
});

describe('phase 2 claim-versus-abstract check', () => {
  it('does not dispatch the claims check when the toggle is off', async () => {
    seedReview('fast', { referenceAudit: 'standard', claimCheck: 'no' }, 2);
    const h = harness({ withEgress: true });
    await runPhase2(h.deps, reviewId);
    expect(h.order).not.toContain('citation-claims');
  });

  it('dispatches the claims check when ticked and supersedes a contradicted first-pass verdict', async () => {
    seedReview('fast', { referenceAudit: 'standard', claimCheck: 'yes' }, 2);
    const h = harness({ withEgress: true, failDoi: 'study-1' });
    await runPhase2(h.deps, reviewId);
    expect(h.order.filter((entry) => entry === 'citation-claims')).toHaveLength(1);

    const current = getCurrentFindings(db, reviewId).map((finding) => finding.id);
    expect(current).toContain('REV-REF-0002');
    expect(current).not.toContain('REV-REF-0001');

    const claimsPrompt = h.claimsPrompts[0] ?? '';
    expect(claimsPrompt).toContain('No abstract was retrievable for this reference.');
    expect(claimsPrompt).toContain('small association');
  });
});
