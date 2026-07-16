import { existsSync, readFileSync } from 'node:fs';
import { Mastra } from '@mastra/core';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { LibSQLStore } from '@mastra/libsql';
import { z } from 'zod';
import { type SectionMap, sectionMapSchema } from '@mara/shared';
import type { MaraDatabase } from '../db/client';
import { grobidExtractor, type GrobidClient, type IngestDeps, ingestManuscript, kindFromMime, ParseHaltError } from '../ingest';
import type { DispatchRunner } from '../providers';
import { type QuarantineItem, scrubSectionMap } from '../sanitize';
import { clarifyingQuestionSchema, liteParse } from './lite-parse';
import {
  getCheckpoint,
  getManuscript,
  getReviewOptions,
  insertEvent,
  insertManuscript,
  mergeReviewOptions,
  updateManuscript,
  updateReview,
  upsertCheckpoint,
} from './repo';
import { sanitizePhase } from './sanitize-phase';
import { manuscriptBlobPath, readManuscriptBlobText, resolveRepoPath, sha256Hex, writeManuscriptBlob } from './storage';

export interface IngestWorkflowDeps {
  db: MaraDatabase;
  runDispatch: DispatchRunner;
  grobid?: GrobidClient;
  ingestOverrides?: Partial<IngestDeps>;
  presetDefault?: string;
}

const ingestInputSchema = z.object({
  reviewId: z.string(),
  filePath: z.string(),
  originalFilename: z.string(),
  mimeType: z.string(),
});

const uploadOutputSchema = z.object({ reviewId: z.string(), kind: z.enum(['pdf', 'docx']), halted: z.boolean() });
const parseOutputSchema = z.object({
  reviewId: z.string(),
  halted: z.boolean(),
  parser: z.enum(['grobid', 'unpdf', 'mammoth']),
  parseQuality: z.enum(['good', 'degraded']),
});
const sanitizeOutputSchema = z.object({ reviewId: z.string(), halted: z.boolean(), tier: z.number().int() });
const liteParseOutputSchema = z.object({ reviewId: z.string(), halted: z.boolean(), questionCount: z.number().int() });
const clarifyOutputSchema = z.object({ reviewId: z.string(), halted: z.boolean(), answered: z.boolean() });
const finalizeOutputSchema = z.object({ reviewId: z.string(), halted: z.boolean(), status: z.string() });

const SECTION_MAP_BLOB = 'parse/section-map.json';
const SANITIZED_SECTION_MAP_BLOB = 'parse/section-map.sanitized.json';
const LITE_PARSE_BLOB = 'parse/lite-parse.json';

export function createIngestWorkflow(deps: IngestWorkflowDeps) {
  const { db } = deps;

  const loadSanitizedSectionMap = (reviewId: string): SectionMap => {
    if (existsSync(manuscriptBlobPath(reviewId, SANITIZED_SECTION_MAP_BLOB))) {
      return sectionMapSchema.parse(JSON.parse(readManuscriptBlobText(reviewId, SANITIZED_SECTION_MAP_BLOB)));
    }
    const rawMap = sectionMapSchema.parse(JSON.parse(readManuscriptBlobText(reviewId, SECTION_MAP_BLOB)));
    const manuscript = getManuscript(db, reviewId);
    const quarantineLog =
      manuscript?.quarantineLogJson !== null && manuscript?.quarantineLogJson !== undefined
        ? (JSON.parse(manuscript.quarantineLogJson) as QuarantineItem[])
        : [];
    const sanitizedMap = scrubSectionMap(rawMap, quarantineLog);
    writeManuscriptBlob(reviewId, SANITIZED_SECTION_MAP_BLOB, JSON.stringify(sanitizedMap));
    return sanitizedMap;
  };

  const uploadIngest = createStep({
    id: 'upload-ingest',
    inputSchema: ingestInputSchema,
    outputSchema: uploadOutputSchema,
    execute: async ({ inputData }) => {
      const done = getCheckpoint(db, inputData.reviewId, 'upload-ingest');
      if (done?.status === 'completed') {
        return uploadOutputSchema.parse(done.snapshot);
      }

      const bytes = readFileSync(resolveRepoPath(inputData.filePath));
      const kind = kindFromMime(inputData.mimeType, inputData.originalFilename);
      const extension = kind === 'pdf' ? 'pdf' : 'docx';
      const blobPath = writeManuscriptBlob(inputData.reviewId, `manuscript/original.${extension}`, bytes);

      if (getManuscript(db, inputData.reviewId) === undefined) {
        insertManuscript(db, {
          reviewId: inputData.reviewId,
          originalFilename: inputData.originalFilename,
          mimeType: inputData.mimeType,
          blobPath,
          byteSize: bytes.byteLength,
          sha256: sha256Hex(bytes),
        });
      }

      updateReview(db, inputData.reviewId, {
        status: 'sanitizing',
        currentPhase: 'phase_0',
        startedAt: new Date().toISOString(),
      });
      insertEvent(db, { reviewId: inputData.reviewId, kind: 'phase_transition', phase: 'phase_0', payload: { step: 'upload-ingest' } });

      const output = { reviewId: inputData.reviewId, kind, halted: false };
      upsertCheckpoint(db, { reviewId: inputData.reviewId, phase: 'upload-ingest', status: 'completed', snapshot: output });
      return output;
    },
  });

  const parse = createStep({
    id: 'parse',
    inputSchema: uploadOutputSchema,
    outputSchema: parseOutputSchema,
    execute: async ({ inputData }) => {
      const done = getCheckpoint(db, inputData.reviewId, 'parse');
      if (done?.status === 'completed') {
        return parseOutputSchema.parse(done.snapshot);
      }

      const manuscript = getManuscript(db, inputData.reviewId);
      if (manuscript === undefined) {
        throw new Error(`No manuscript row for review ${inputData.reviewId}`);
      }
      const bytes = readFileSync(resolveRepoPath(manuscript.blobPath));

      const haltParse = (reason: string): z.infer<typeof parseOutputSchema> => {
        const output = { reviewId: inputData.reviewId, halted: true, parser: 'unpdf' as const, parseQuality: 'degraded' as const };
        upsertCheckpoint(db, { reviewId: inputData.reviewId, phase: 'parse', status: 'failed', snapshot: { ...output, haltReason: reason } });
        insertEvent(db, {
          reviewId: inputData.reviewId,
          kind: 'error',
          phase: 'phase_0',
          payload: { step: 'parse', halted: true, reason },
        });
        return output;
      };

      if (inputData.kind === 'pdf' && deps.ingestOverrides?.grobidExtract === undefined) {
        if (deps.grobid === undefined) {
          return haltParse('GROBID is not configured, and a structured parse is required for PDF manuscripts');
        }
        const alive = await deps.grobid.isAlive().catch(() => false);
        if (!alive) {
          return haltParse(`GROBID at ${deps.grobid.baseUrl} is unreachable, and a structured parse is required for PDF manuscripts`);
        }
      }

      const ingestDeps: IngestDeps = {
        ...(deps.grobid !== undefined ? { grobidExtract: grobidExtractor(deps.grobid) } : {}),
        persistTei: (tei) => writeManuscriptBlob(inputData.reviewId, 'manuscript/structure.tei.xml', tei),
        ...(deps.ingestOverrides ?? {}),
      };

      let result;
      try {
        result = await ingestManuscript({ bytes, kind: inputData.kind }, ingestDeps);
      } catch (error) {
        if (error instanceof ParseHaltError) {
          return haltParse(error.reason);
        }
        throw error;
      }
      writeManuscriptBlob(inputData.reviewId, SECTION_MAP_BLOB, JSON.stringify(result.sectionMap));
      if (result.teiPath !== null) {
        updateManuscript(db, inputData.reviewId, { teiStructurePath: result.teiPath });
      }
      insertEvent(db, {
        reviewId: inputData.reviewId,
        kind: 'phase_transition',
        phase: 'phase_0',
        payload: { step: 'parse', parser: result.decision.parser, parseQuality: result.decision.parseQuality, fallbackReason: result.decision.fallbackReason },
      });

      const output = {
        reviewId: inputData.reviewId,
        halted: false,
        parser: result.decision.parser,
        parseQuality: result.decision.parseQuality,
      };
      upsertCheckpoint(db, { reviewId: inputData.reviewId, phase: 'parse', status: 'completed', snapshot: output });
      return output;
    },
  });

  const sanitize = createStep({
    id: 'sanitize',
    inputSchema: parseOutputSchema,
    outputSchema: sanitizeOutputSchema,
    execute: async ({ inputData }) => {
      if (inputData.halted) {
        return { reviewId: inputData.reviewId, halted: true, tier: 0 };
      }
      const done = getCheckpoint(db, inputData.reviewId, 'sanitize');
      if (done?.status === 'completed' || done?.status === 'failed') {
        return sanitizeOutputSchema.parse(done.snapshot);
      }

      const sectionMap = sectionMapSchema.parse(JSON.parse(readManuscriptBlobText(inputData.reviewId, SECTION_MAP_BLOB)));
      const result = await sanitizePhase({ db, reviewId: inputData.reviewId, text: sectionMap.fullText, runDispatch: deps.runDispatch });
      const sanitizedMap = scrubSectionMap(sectionMap, result.quarantineLog);
      writeManuscriptBlob(inputData.reviewId, SANITIZED_SECTION_MAP_BLOB, JSON.stringify(sanitizedMap));

      const output = { reviewId: inputData.reviewId, halted: result.halted, tier: result.tier };
      upsertCheckpoint(db, {
        reviewId: inputData.reviewId,
        phase: 'sanitize',
        status: result.halted ? 'failed' : 'completed',
        snapshot: output,
      });
      return output;
    },
  });

  const liteParseStep = createStep({
    id: 'lite-parse',
    inputSchema: sanitizeOutputSchema,
    outputSchema: liteParseOutputSchema,
    execute: async ({ inputData }) => {
      if (inputData.halted) {
        return { reviewId: inputData.reviewId, halted: true, questionCount: 0 };
      }
      const done = getCheckpoint(db, inputData.reviewId, 'lite-parse');
      if (done?.status === 'completed') {
        return liteParseOutputSchema.parse(done.snapshot);
      }

      const sectionMap = loadSanitizedSectionMap(inputData.reviewId);
      const options = getReviewOptions(db, inputData.reviewId);
      const presetDefault = typeof options.preset === 'string' ? options.preset : deps.presetDefault;
      const journalProvided = typeof options.journal === 'string' && options.journal.length > 0;

      const lite = await liteParse({
        sectionMap,
        runDispatch: deps.runDispatch,
        reviewId: inputData.reviewId,
        ...(presetDefault !== undefined ? { presetDefault } : {}),
        journalProvided,
      });

      writeManuscriptBlob(inputData.reviewId, LITE_PARSE_BLOB, JSON.stringify(lite));
      updateReview(db, inputData.reviewId, { currentPhase: 'phase_1' });
      insertEvent(db, {
        reviewId: inputData.reviewId,
        kind: 'phase_transition',
        phase: 'phase_1',
        payload: { step: 'lite-parse', wordCount: lite.deterministic.wordCount, sections: lite.deterministic.sectionCount },
      });

      const output = { reviewId: inputData.reviewId, halted: false, questionCount: lite.questions.length };
      upsertCheckpoint(db, {
        reviewId: inputData.reviewId,
        phase: 'lite-parse',
        status: 'completed',
        snapshot: { ...output, questions: lite.questions, provisional: lite.provisional },
      });
      return output;
    },
  });

  const clarify = createStep({
    id: 'clarify',
    inputSchema: liteParseOutputSchema,
    outputSchema: clarifyOutputSchema,
    resumeSchema: z.object({ answers: z.record(z.string(), z.string()), preset: z.string().optional() }),
    suspendSchema: z.object({ questions: z.array(clarifyingQuestionSchema), reviewId: z.string() }),
    execute: async ({ inputData, resumeData, suspend }) => {
      if (inputData.halted) {
        return { reviewId: inputData.reviewId, halted: true, answered: false };
      }
      const done = getCheckpoint(db, inputData.reviewId, 'clarify');
      if (done?.status === 'completed') {
        return clarifyOutputSchema.parse(done.snapshot);
      }

      if (resumeData === undefined) {
        const liteCheckpoint = getCheckpoint(db, inputData.reviewId, 'lite-parse');
        const snapshot = (liteCheckpoint?.snapshot ?? {}) as { questions?: unknown };
        const questions = clarifyingQuestionSchema.array().parse(snapshot.questions ?? []);
        updateReview(db, inputData.reviewId, { status: 'awaiting_input' });
        insertEvent(db, { reviewId: inputData.reviewId, kind: 'phase_transition', phase: 'phase_1', payload: { awaitingInput: true, questionCount: questions.length } });
        return (await suspend({ questions, reviewId: inputData.reviewId })) as unknown as z.infer<
          typeof clarifyOutputSchema
        >;
      }

      const preset = resumeData.preset ?? resumeData.answers.preset ?? deps.presetDefault ?? 'balanced';
      mergeReviewOptions(db, inputData.reviewId, { preset, answers: resumeData.answers });
      updateReview(db, inputData.reviewId, { status: 'running' });
      insertEvent(db, {
        reviewId: inputData.reviewId,
        kind: 'control_ack',
        phase: 'phase_1',
        payload: { answered: Object.keys(resumeData.answers), preset },
      });

      const output = { reviewId: inputData.reviewId, halted: false, answered: true };
      upsertCheckpoint(db, { reviewId: inputData.reviewId, phase: 'clarify', status: 'completed', snapshot: { ...output, preset } });
      return output;
    },
  });

  const finalize = createStep({
    id: 'finalize',
    inputSchema: clarifyOutputSchema,
    outputSchema: finalizeOutputSchema,
    execute: async ({ inputData }) => {
      const done = getCheckpoint(db, inputData.reviewId, 'phase_1');
      if (done?.status === 'completed') {
        return { reviewId: inputData.reviewId, halted: false, status: 'ingested' };
      }
      if (done?.status === 'failed' || inputData.halted) {
        upsertCheckpoint(db, { reviewId: inputData.reviewId, phase: 'phase_1', status: 'failed', snapshot: { ingestComplete: false } });
        return { reviewId: inputData.reviewId, halted: true, status: 'halted' };
      }
      updateReview(db, inputData.reviewId, { status: 'running', currentPhase: 'phase_1' });
      insertEvent(db, { reviewId: inputData.reviewId, kind: 'phase_transition', phase: 'phase_1', payload: { ingestComplete: true } });
      upsertCheckpoint(db, { reviewId: inputData.reviewId, phase: 'phase_1', status: 'completed', snapshot: { ingestComplete: true } });
      return { reviewId: inputData.reviewId, halted: false, status: 'ingested' };
    },
  });

  return createWorkflow({ id: 'ingest', inputSchema: ingestInputSchema, outputSchema: finalizeOutputSchema })
    .then(uploadIngest)
    .then(parse)
    .then(sanitize)
    .then(liteParseStep)
    .then(clarify)
    .then(finalize)
    .commit();
}

export interface BuildIngestMastraOptions extends IngestWorkflowDeps {
  mastraDbPath: string;
}

export function buildIngestMastra(options: BuildIngestMastraOptions): Mastra {
  const workflow = createIngestWorkflow(options);
  const url = `file:${options.mastraDbPath.split('\\').join('/')}`;
  return new Mastra({
    storage: new LibSQLStore({ id: 'mara-ingest-storage', url }),
    workflows: { ingest: workflow },
  });
}
