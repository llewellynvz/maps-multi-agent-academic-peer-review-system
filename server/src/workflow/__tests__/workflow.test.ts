import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type MaraDatabase, type SqliteConnection } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { blobDir } from '../../paths';
import type { DispatchInput, DispatchResult } from '../../providers';
import { buildIngestMastra, resumeIngest, startIngest } from '../index';

const teiXml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ingest', '__tests__', 'fixtures', 'sample.tei.xml'),
  'utf8',
);

function dispatchResult(object: unknown): DispatchResult {
  return {
    dispatchId: randomUUID(),
    provider: 'azure',
    model: 'gpt-cheap',
    status: 'success',
    object,
    tokens: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, reasoningTokens: 0 },
    latencyMs: 1,
    langfuseTraceId: null,
    replayed: false,
  };
}

const mockDispatch = async (input: DispatchInput): Promise<DispatchResult> => {
  if (input.agent === 'manuscript-sanitizer') {
    return dispatchResult({ tier: 0, spans: [], rationale: 'clean' });
  }
  return dispatchResult({
    field: 'positive psychology',
    studyDesign: 'review',
    manuscriptType: 'review article',
    language: 'en',
    wordCountEstimate: 4200,
  });
};

let tempDir: string;
let dbPath: string;
let mastraPath: string;
let sqlite: SqliteConnection;
let db: MaraDatabase;
let pdfPath: string;
const reviewId = `wf-test-${randomUUID()}`;

function insertReview(id: string): void {
  const now = new Date().toISOString();
  sqlite.prepare('INSERT INTO reviews (id, slug, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, id, now, now);
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-wf-'));
  dbPath = join(tempDir, 'mara.db');
  mastraPath = join(tempDir, 'mastra.db');
  pdfPath = join(tempDir, 'sample.pdf');
  writeFileSync(pdfPath, Buffer.from('%PDF-1.4 placeholder for a stubbed grobid extractor'));
  const client = createDb(dbPath);
  db = client.db;
  sqlite = client.sqlite;
  runMigrations(db);
  insertReview(reviewId);
});

afterAll(() => {
  try {
    sqlite.close();
  } catch {
    /* ignore */
  }
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* windows libsql file lock */
  }
  try {
    rmSync(blobDir(reviewId), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('ingest workflow', () => {
  it('parses, sanitises, suspends for answers, resumes, and stays idempotent on re-run', async () => {
    const deps = {
      db,
      runDispatch: mockDispatch,
      ingestOverrides: { grobidExtract: async () => teiXml },
      mastraDbPath: mastraPath,
    };

    const mastra = buildIngestMastra(deps);
    const started = await startIngest(mastra, {
      reviewId,
      filePath: pdfPath,
      originalFilename: 'sample.pdf',
      mimeType: 'application/pdf',
    });

    expect(started.status).toBe('suspended');

    const reviewAfterSuspend = sqlite.prepare('SELECT status FROM reviews WHERE id = ?').get(reviewId) as { status: string };
    expect(reviewAfterSuspend.status).toBe('awaiting_input');

    const liteCheckpoint = sqlite
      .prepare("SELECT snapshot_json FROM phase_checkpoints WHERE review_id = ? AND phase = 'lite-parse'")
      .get(reviewId) as { snapshot_json: string };
    const questions = (JSON.parse(liteCheckpoint.snapshot_json) as { questions: unknown[] }).questions;
    expect(questions.length).toBeGreaterThanOrEqual(2);

    const dispatchesAfterFirst = (
      sqlite.prepare('SELECT count(*) AS n FROM dispatches WHERE review_id = ?').get(reviewId) as { n: number }
    ).n;

    const resumed = await resumeIngest(mastra, started.runId, {
      answers: { preset: 'balanced', field: 'positive psychology', journal: 'Journal of Happiness Studies' },
    });
    expect(resumed.status).toBe('success');

    const reviewAfterResume = sqlite.prepare('SELECT status, options_json FROM reviews WHERE id = ?').get(reviewId) as {
      status: string;
      options_json: string;
    };
    expect(reviewAfterResume.status).toBe('running');
    const options = JSON.parse(reviewAfterResume.options_json) as { preset?: string; answers?: Record<string, string> };
    expect(options.preset).toBe('balanced');
    expect(options.answers?.journal).toBe('Journal of Happiness Studies');

    const phaseCheckpoint = sqlite
      .prepare("SELECT status FROM phase_checkpoints WHERE review_id = ? AND phase = 'phase_1'")
      .get(reviewId) as { status: string };
    expect(phaseCheckpoint.status).toBe('completed');

    const teiRecorded = sqlite.prepare('SELECT tei_structure_path FROM manuscripts WHERE review_id = ?').get(reviewId) as {
      tei_structure_path: string | null;
    };
    expect(teiRecorded.tei_structure_path).not.toBeNull();

    const secondMastra = buildIngestMastra(deps);
    const rerun = await startIngest(secondMastra, {
      reviewId,
      filePath: pdfPath,
      originalFilename: 'sample.pdf',
      mimeType: 'application/pdf',
    });
    expect(rerun.status).toBe('success');

    const manuscriptCount = (
      sqlite.prepare('SELECT count(*) AS n FROM manuscripts WHERE review_id = ?').get(reviewId) as { n: number }
    ).n;
    expect(manuscriptCount).toBe(1);

    const dispatchesAfterRerun = (
      sqlite.prepare('SELECT count(*) AS n FROM dispatches WHERE review_id = ?').get(reviewId) as { n: number }
    ).n;
    expect(dispatchesAfterRerun).toBe(dispatchesAfterFirst);
  });
});
