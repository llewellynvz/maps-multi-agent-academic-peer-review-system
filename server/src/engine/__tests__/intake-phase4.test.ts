import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MaraDatabase, type SqliteConnection } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { getEvidenceData } from '../../data/evidence';
import { getCurrentFindings } from '../../ledger';
import { blobDir } from '../../paths';
import type { DispatchInput, DispatchResult } from '../../providers/dispatch';
import { writeManuscriptBlob } from '../../workflow/storage';
import { writeArtefact } from '../artefacts';
import type { EngineDeps } from '../phases-shared';
import { runPhase4 } from '../phases';

let tempDir: string;
let db: MaraDatabase;
let sqlite: SqliteConnection;
let reviewId: string;

const PRIOR_SENTINEL = 'ZZZPRIORSENTINELZZZ';
const selfCritique = { strongestObjection: 'Mock output; not derived from evidence.', confidenceRaisers: ['A real dispatch'] };

function aicFinding(): Record<string, unknown> {
  return {
    id: 'REV-AIC-0001',
    lens: 'REV-AIC',
    phase: 4,
    claim: 'Several references could not be located, a pattern that may warrant editorial review.',
    anchor: 'References, entries 14 and 31',
    epistemic: 'Inferred',
    confidence: 0.82,
    band: 'Yellow',
    severity: 'major',
    fixability: 'unclear',
    scope: 'author-facing',
    failureScenario: 'If the references are absent, the claims resting on them are unsupported.',
    leanestFix: 'Ask the authors to supply stable records.',
    supersedes: null,
  };
}

function aiContent(): Record<string, unknown> {
  return {
    signals: [
      { kind: 'reference-integrity', anchor: 'References', strength: 'serious', falsePositiveCaveat: 'Indexing gaps mimic this.' },
    ],
    disclosureCheck: 'No declaration of AI assistance is present.',
    notRun: [],
    findings: [aicFinding()],
    selfCritique,
  };
}

function integrity(cluster: string): Record<string, unknown> {
  return { cluster, checks: [], findings: [], selfCritique };
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
  agents: string[];
  dispatchInputs: string[];
  integrityPrompts: string[];
}

function harness(): Harness {
  const agents: string[] = [];
  const dispatchInputs: string[] = [];
  const integrityPrompts: string[] = [];
  const runDispatch = async (input: DispatchInput): Promise<DispatchResult> => {
    agents.push(input.agent);
    dispatchInputs.push(`${String(input.parts.system)}\n${String(input.parts.prompt)}`);
    if (input.agent === 'integrity-screener') {
      integrityPrompts.push(String(input.parts.prompt));
      const match = /cluster "([^"]+)"/.exec(String(input.parts.prompt));
      return successResult(integrity(match?.[1] ?? 'unknown'));
    }
    if (input.agent === 'ai-content-analyst') {
      return successResult(aiContent());
    }
    if (input.agent === 'phase-critic') {
      return successResult({ verdict: 'clean', defects: [], strongestGap: 'No material gap.', selfCritique });
    }
    throw new Error(`unexpected agent ${input.agent}`);
  };
  return { deps: { db, runDispatch }, agents, dispatchInputs, integrityPrompts };
}

function seedReview(answers: Record<string, unknown>): void {
  const now = new Date().toISOString();
  sqlite
    .prepare('INSERT INTO reviews (id, slug, status, options_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(reviewId, reviewId, 'running', JSON.stringify({ preset: 'balanced', answers }), now, now);
  const sectionMap = {
    title: 'A brief wellbeing trial',
    abstract: 'A short abstract.',
    sections: [{ index: 0, heading: 'Results', text: 'The mean was 8.40.', lineStart: 1, lineEnd: 3 }],
    references: [],
    fullText: 'The mean was 8.40.',
    parser: 'grobid',
    parseQuality: 'good',
  };
  writeManuscriptBlob(reviewId, 'parse/section-map.json', JSON.stringify(sectionMap));
  writeArtefact(reviewId, 'p1-analyst-a', {
    manuscriptMap: [],
    figureTableInventory: [],
    metadataDeclarations: { aiUseDisclosure: 'absent' },
  });
  writeArtefact(reviewId, 'p1-analyst-b', { claimEvidenceMatrix: [] });
  writeArtefact(reviewId, 'p2-citations', { verifications: [] });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-intake-p4-'));
  const client = createDb(join(tempDir, 'mara.db'));
  db = client.db;
  sqlite = client.sqlite;
  runMigrations(db);
  reviewId = `ip4-${Date.now()}-${Math.random().toString(36).slice(2)}`;
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(blobDir(reviewId), { recursive: true, force: true });
});

describe('phase 4 AI-content analyst wiring', () => {
  it('runs the analyst by default and keeps a serious signal editor-only and out of the served payload', async () => {
    seedReview({});
    const h = harness();
    await runPhase4(h.deps, reviewId);
    expect(h.agents.filter((agent) => agent === 'ai-content-analyst')).toHaveLength(1);

    const aic = getCurrentFindings(db, reviewId).find((finding) => finding.id.startsWith('REV-AIC-'));
    expect(aic?.scope).toBe('editor_only');

    const served = getEvidenceData(db, reviewId).findings.map((finding) => finding.id);
    expect(served).not.toContain(aic?.id);
  });

  it('narrows the similarity cluster to similarity only when the analyst runs', async () => {
    seedReview({});
    const h = harness();
    await runPhase4(h.deps, reviewId);
    const narrowed = h.integrityPrompts.find((prompt) => prompt.includes('similarity-and-ai-content'));
    expect(narrowed).toContain('handled by the dedicated AI-content analyst');
  });

  it('skips the analyst when aiDetection is off and leaves the cluster covering AI content', async () => {
    seedReview({ aiDetection: 'no' });
    const h = harness();
    await runPhase4(h.deps, reviewId);
    expect(h.agents).not.toContain('ai-content-analyst');
    const cluster = h.integrityPrompts.find((prompt) => prompt.includes('similarity-and-ai-content'));
    expect(cluster).not.toContain('handled by the dedicated AI-content analyst');
    expect(cluster).toContain('REV-AIC');
  });
});

describe('withheld-prior invariant', () => {
  it('never places the user prior into any phase 1-6 dispatch input (NAMED)', async () => {
    seedReview({ userPrior: PRIOR_SENTINEL, aiDetection: 'yes' });
    const h = harness();
    await runPhase4(h.deps, reviewId);
    expect(h.dispatchInputs.length).toBeGreaterThan(0);
    for (const input of h.dispatchInputs) {
      expect(input).not.toContain(PRIOR_SENTINEL);
    }
  });
});
