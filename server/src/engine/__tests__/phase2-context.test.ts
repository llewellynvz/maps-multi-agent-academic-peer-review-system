import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MaraDatabase, type SqliteConnection } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { CROSSREF_HOST, OPENALEX_HOST } from '../../citations/allowlist';
import type { FetchLike, HttpResponse } from '../../citations/types';
import { blobDir } from '../../paths';
import type { DispatchInput, DispatchResult } from '../../providers/dispatch';
import { createEgressController } from '../../security';
import { writeManuscriptBlob } from '../../workflow/storage';
import { readArtefact, writeArtefact } from '../artefacts';
import type { EngineDeps } from '../phases-shared';
import { runPhase2 } from '../phases';

let tempDir: string;
let db: MaraDatabase;
let sqlite: SqliteConnection;
let reviewId: string;

const selfCritique = { strongestObjection: 'Mock output; not derived from evidence.', confidenceRaisers: ['A real dispatch'] };

const CONF_PHRASE =
  'the strengths intervention improved employee wellbeing over twelve weeks in a randomised field setting analysed with mixed effects models';

function ok(value: unknown): HttpResponse {
  return { ok: true, status: 200, json: async () => value };
}

function ctxFinding(): Record<string, unknown> {
  return {
    id: 'REV-CTX-0001',
    lens: 'field-context',
    phase: 2,
    claim: 'The reported effect exceeds field benchmarks.',
    anchor: 'Results, lines 1-3',
    epistemic: 'Inferred',
    confidence: 0.8,
    band: 'Yellow',
    severity: 'moderate',
    fixability: 'moderate',
    scope: 'author-facing',
    failureScenario: 'An above-benchmark effect can signal an artefact.',
    leanestFix: 'Situate the effect against retrieved comparators.',
    supersedes: null,
  };
}

function planObject(queries: Array<{ query: string; purpose: string }>): Record<string, unknown> {
  return {
    mode: 'plan',
    queryVocabulary: ['brief mindfulness', 'student wellbeing'],
    topicQueries: queries,
    selfCritique,
  };
}

function dossierObject(): Record<string, unknown> {
  return {
    queryVocabulary: ['brief mindfulness', 'student wellbeing'],
    retrievalLog: [
      {
        query: 'brief mindfulness student wellbeing trial',
        source: 'openalex',
        date: '2026-07-15',
        resultsReviewed: 1,
        resultsIncluded: 1,
        rationale: 'Closest retrieved comparator.',
      },
    ],
    comparators: [{ citation: 'Retrieved comparator', relevance: 'Benchmarks the reported effect.' }],
    keyPapers: [{ citation: 'Smith (2024) brief mindfulness trial', whyItMatters: 'Benchmarks the Results effect.' }],
    contestedClaims: ['The effect is larger than pooled estimates.'],
    recentReviews: ['A 2024 review of brief interventions.'],
    methodNorms: ['Report attrition for randomised trials.'],
    gapMap: 'Positioned against school programmes only.',
    biasStatement: 'English-only, Western-indexed search.',
    benchmarks: [{ metric: 'effect', value: '0.2 to 0.3 SD', source: 'retrieved review', tension: null }],
    sourceAvailability: [],
    findings: [ctxFinding()],
    selfCritique,
  };
}

function citationObject(): Record<string, unknown> {
  return {
    samplingStrategy: 'All references.',
    totalCoverage: 1,
    verifications: [],
    weakSourceFlags: [],
    hygieneFindings: [],
    findings: [],
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
}

function harness(planQueries: Array<{ query: string; purpose: string }>, egress: EngineDeps['egress']): Harness {
  const order: string[] = [];
  const runDispatch = async (input: DispatchInput): Promise<DispatchResult> => {
    if (input.agent === 'field-context-scout') {
      const isPlan = String(input.parts.prompt).includes('Mode: plan');
      order.push(isPlan ? 'scout-plan' : 'scout-dossier');
      return successResult(isPlan ? planObject(planQueries) : dossierObject());
    }
    if (input.agent === 'citation-auditor') {
      order.push('citation');
      return successResult(citationObject());
    }
    throw new Error(`unexpected agent ${input.agent}`);
  };
  return { deps: { db, runDispatch, ...(egress !== undefined ? { egress } : {}) }, order };
}

function seedReview(preset: string): void {
  const now = new Date().toISOString();
  sqlite
    .prepare('INSERT INTO reviews (id, slug, status, options_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(reviewId, reviewId, 'running', JSON.stringify({ preset, answers: {} }), now, now);
  const sectionMap = {
    title: 'A brief wellbeing trial',
    abstract: 'A short abstract.',
    sections: [{ index: 0, heading: 'Results', text: CONF_PHRASE, lineStart: 1, lineEnd: 3 }],
    references: [],
    fullText: CONF_PHRASE,
    parser: 'grobid',
    parseQuality: 'good',
  };
  writeManuscriptBlob(reviewId, 'parse/section-map.json', JSON.stringify(sectionMap));
  writeArtefact(reviewId, 'p1-analyst-b', { claimEvidenceMatrix: [] });
}

function events(kind: string): Array<{ egressTarget: string | null; payload: Record<string, unknown> }> {
  const rows = sqlite
    .prepare('SELECT egress_target, payload_json FROM review_events WHERE review_id = ? AND kind = ? ORDER BY seq')
    .all(reviewId, kind) as Array<{ egress_target: string | null; payload_json: string }>;
  return rows.map((row) => ({ egressTarget: row.egress_target, payload: JSON.parse(row.payload_json) }));
}

function checkpointStatus(): string | undefined {
  const row = sqlite
    .prepare('SELECT status FROM phase_checkpoints WHERE review_id = ? AND phase = ?')
    .get(reviewId, 'engine_phase_2') as { status: string } | undefined;
  return row?.status;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-p2-'));
  const client = createDb(join(tempDir, 'mara.db'));
  db = client.db;
  sqlite = client.sqlite;
  runMigrations(db);
  reviewId = `p2-${Date.now()}-${Math.random().toString(36).slice(2)}`;
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(blobDir(reviewId), { recursive: true, force: true });
});

describe('phase 2 field dossier', () => {
  it('runs plan then guarded search then dossier on the balanced preset', async () => {
    seedReview('balanced');
    const baseFetch: FetchLike = async (url) => {
      if (url.includes(OPENALEX_HOST)) {
        return ok({ results: [{ title: 'Retrieved work', publication_year: 2024, cited_by_count: 9 }] });
      }
      if (url.includes(CROSSREF_HOST)) {
        return ok({ message: { items: [{ title: ['Retrieved crossref work'], issued: { 'date-parts': [[2023]] } }] } });
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const egress = createEgressController(baseFetch);
    const h = harness(
      [
        { query: 'brief mindfulness student wellbeing trial', purpose: 'comparators' },
        { query: 'wellbeing measure validation students', purpose: 'instrument' },
        { query: 'mindfulness effect size meta analysis', purpose: 'benchmark' },
      ],
      egress,
    );

    await runPhase2(h.deps, reviewId);

    expect(h.order.indexOf('scout-plan')).toBeGreaterThanOrEqual(0);
    expect(h.order.indexOf('scout-plan')).toBeLessThan(h.order.indexOf('scout-dossier'));

    const plan = readArtefact<{ topicQueries: unknown[] }>(reviewId, 'p2-scout-plan');
    expect(plan.topicQueries).toHaveLength(3);

    const topic = readArtefact<{ executedQueries: string[]; results: Array<{ source: string; items: unknown[] }> }>(
      reviewId,
      'p2-topic-results',
    );
    expect(topic.executedQueries).toHaveLength(3);
    expect(topic.results).toHaveLength(6);
    expect(topic.results.some((entry) => entry.source === 'openalex' && entry.items.length === 1)).toBe(true);

    const dossier = readArtefact<{ keyPapers: unknown[] }>(reviewId, 'p2-context');
    expect(dossier.keyPapers).toHaveLength(1);

    const webQueries = events('web_query');
    expect(webQueries.length).toBeGreaterThanOrEqual(6);
    expect(webQueries.every((entry) => entry.payload.blocked === false)).toBe(true);
    expect(checkpointStatus()).toBe('completed');
  });

  it('blocks a plan query that quotes the manuscript and still completes with the dossier', async () => {
    seedReview('balanced');
    const baseFetch: FetchLike = async (url) => {
      if (url.includes(OPENALEX_HOST)) {
        return ok({ results: [{ title: 'Clean comparator', publication_year: 2024 }] });
      }
      if (url.includes(CROSSREF_HOST)) {
        return ok({ message: { items: [] } });
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const egress = createEgressController(baseFetch);
    const h = harness(
      [
        { query: 'the strengths intervention improved employee wellbeing over twelve weeks', purpose: 'leaked quote' },
        { query: 'employee wellbeing intervention comparators', purpose: 'comparators' },
        { query: 'strengths intervention effect size review', purpose: 'benchmark' },
      ],
      egress,
    );

    await runPhase2(h.deps, reviewId);

    const webQueries = events('web_query');
    expect(webQueries.some((entry) => entry.payload.blocked === true && entry.payload.reason === 'ngram')).toBe(true);
    expect(webQueries.some((entry) => entry.payload.blocked === false)).toBe(true);

    const topic = readArtefact<{ results: Array<{ query: string; items: unknown[] }> }>(reviewId, 'p2-topic-results');
    const blocked = topic.results.filter((entry) =>
      entry.query.startsWith('the strengths intervention improved employee wellbeing'),
    );
    expect(blocked.length).toBe(2);
    expect(blocked.every((entry) => entry.items.length === 0)).toBe(true);

    expect(readArtefact<{ keyPapers: unknown[] }>(reviewId, 'p2-context').keyPapers).toHaveLength(1);
    expect(checkpointStatus()).toBe('completed');
  });

  it('keeps the single offline scout dispatch on the fast preset', async () => {
    seedReview('fast');
    const h = harness([], undefined);

    await runPhase2(h.deps, reviewId);

    expect(h.order.filter((entry) => entry === 'scout-plan')).toHaveLength(0);
    expect(h.order.filter((entry) => entry === 'scout-dossier')).toHaveLength(1);
    expect(() => readArtefact(reviewId, 'p2-scout-plan')).toThrow();
    expect(() => readArtefact(reviewId, 'p2-context')).not.toThrow();
    expect(events('web_query')).toHaveLength(0);
    expect(checkpointStatus()).toBe('completed');
  });
});
