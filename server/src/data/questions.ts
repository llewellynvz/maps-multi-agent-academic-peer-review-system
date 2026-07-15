import { existsSync } from 'node:fs';
import type { MaraDatabase } from '../db/client';
import { getCheckpoint } from '../workflow/repo';
import { manuscriptBlobPath, readManuscriptBlobText } from '../workflow/storage';
import { ApiError } from './errors';
import { requireReview } from './reviews';
import type { Detected, Question, QuestionsResponse } from './types';

interface RawQuestion {
  id: string;
  kind: 'preset' | 'metadata';
  field: string;
  prompt: string;
  options?: string[];
  defaultValue: string | null;
}

interface LiteParseBlob {
  deterministic: { wordCount: number; sectionCount: number; referenceCount: number; hasAbstract?: boolean };
  provisional: { field: string; studyDesign: string; manuscriptType: string; language: string; wordCountEstimate: number };
  questions: RawQuestion[];
}

const LITE_PARSE_BLOB = 'parse/lite-parse.json';

function parseQualityFor(db: MaraDatabase, reviewId: string): 'good' | 'degraded' {
  const snapshot = getCheckpoint(db, reviewId, 'parse')?.snapshot as { parseQuality?: string } | null;
  return snapshot?.parseQuality === 'degraded' ? 'degraded' : 'good';
}

function mapQuestion(raw: RawQuestion, detectedField: string): Question {
  const fallbackDefault = raw.defaultValue ?? (raw.options?.[0] ?? '');
  if (raw.kind === 'preset' || (raw.options !== undefined && raw.options.length > 0)) {
    return {
      id: raw.id,
      kind: 'choice',
      prompt: raw.prompt,
      ...(raw.options !== undefined ? { options: raw.options } : {}),
      ...(raw.defaultValue !== null ? { detectedValue: raw.defaultValue } : {}),
      default: fallbackDefault,
    };
  }
  if (raw.defaultValue !== null && raw.defaultValue !== '') {
    return {
      id: raw.id,
      kind: 'confirm',
      prompt: raw.prompt,
      detectedValue: raw.field === 'field' ? detectedField : raw.defaultValue,
      default: fallbackDefault,
    };
  }
  return { id: raw.id, kind: 'text', prompt: raw.prompt, default: fallbackDefault };
}

export function getQuestions(db: MaraDatabase, reviewId: string): QuestionsResponse {
  requireReview(db, reviewId);
  const liteDone = getCheckpoint(db, reviewId, 'lite-parse')?.status === 'completed';
  const blobPath = manuscriptBlobPath(reviewId, LITE_PARSE_BLOB);
  if (!liteDone || !existsSync(blobPath)) {
    throw new ApiError('parse_incomplete', 'The manuscript is still being read. Questions are not ready yet.');
  }

  const blob = JSON.parse(readManuscriptBlobText(reviewId, LITE_PARSE_BLOB)) as LiteParseBlob;
  const detected: Detected = {
    field: blob.provisional.field,
    studyDesign: blob.provisional.studyDesign,
    manuscriptType: blob.provisional.manuscriptType,
    language: blob.provisional.language,
    wordCount: blob.deterministic.wordCount,
    sectionCount: blob.deterministic.sectionCount,
    referenceCount: blob.deterministic.referenceCount,
    hasAbstract: blob.deterministic.hasAbstract ?? false,
    parseQuality: parseQualityFor(db, reviewId),
  };
  const questions = blob.questions.map((raw) => mapQuestion(raw, detected.field));
  return { detected, questions };
}

export function loadRawQuestions(reviewId: string): RawQuestion[] {
  const blobPath = manuscriptBlobPath(reviewId, LITE_PARSE_BLOB);
  if (!existsSync(blobPath)) {
    return [];
  }
  return (JSON.parse(readManuscriptBlobText(reviewId, LITE_PARSE_BLOB)) as LiteParseBlob).questions;
}
