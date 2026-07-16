import { readFileSync } from 'node:fs';
import mammoth from 'mammoth';
import { eq } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { voiceSamples } from '../db/schema';
import { extractPdfText } from '../ingest/pdf';
import { insertVoiceSample } from '../workflow/repo';
import { resolveRepoPath, sha256Hex, writeManuscriptBlob } from '../workflow/storage';
import { ApiError } from './errors';
import { requireReview } from './reviews';

export const MAX_VOICE_SAMPLES = 2;

type VoiceExtension = 'pdf' | 'docx' | 'txt' | 'md';

const ACCEPTED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
]);

function extensionFor(mimeType: string, filename: string): VoiceExtension | null {
  const name = filename.toLowerCase();
  if (mimeType === 'application/pdf' || name.endsWith('.pdf')) {
    return 'pdf';
  }
  if (mimeType.includes('wordprocessingml') || name.endsWith('.docx')) {
    return 'docx';
  }
  if (name.endsWith('.md') || mimeType === 'text/markdown') {
    return 'md';
  }
  if (name.endsWith('.txt') || mimeType === 'text/plain') {
    return 'txt';
  }
  return null;
}

export interface VoiceSampleRow {
  id: string;
  originalFilename: string;
  mimeType: string;
  blobPath: string;
  byteSize: number;
}

interface VoiceSampleFull extends VoiceSampleRow {
  sha256: string;
}

function selectVoiceSamples(db: MaraDatabase, reviewId: string): VoiceSampleFull[] {
  return db
    .select({
      id: voiceSamples.id,
      originalFilename: voiceSamples.originalFilename,
      mimeType: voiceSamples.mimeType,
      blobPath: voiceSamples.blobPath,
      byteSize: voiceSamples.byteSize,
      sha256: voiceSamples.sha256,
    })
    .from(voiceSamples)
    .where(eq(voiceSamples.reviewId, reviewId))
    .all();
}

export function listVoiceSamples(db: MaraDatabase, reviewId: string): VoiceSampleRow[] {
  return selectVoiceSamples(db, reviewId).map(({ sha256, ...row }) => {
    void sha256;
    return row;
  });
}

export interface VoiceUploadResult {
  voiceSampleId: string;
  sha256: string;
  byteSize: number;
  count: number;
}

export function uploadVoiceSample(
  db: MaraDatabase,
  reviewId: string,
  file: { bytes: Uint8Array; filename: string; mimeType: string },
): VoiceUploadResult {
  requireReview(db, reviewId);

  const extension = extensionFor(file.mimeType, file.filename);
  if (extension === null && !ACCEPTED_MIME.has(file.mimeType)) {
    throw new ApiError('unprocessable', 'Upload a past review letter as PDF, DOCX, TXT, or Markdown.', {
      field: 'file',
      mimeType: file.mimeType,
    });
  }

  const existing = selectVoiceSamples(db, reviewId);
  const sha256 = sha256Hex(file.bytes);
  const match = existing.find((row) => row.sha256 === sha256);
  if (match !== undefined) {
    return { voiceSampleId: match.id, sha256, byteSize: file.bytes.byteLength, count: existing.length };
  }

  if (existing.length >= MAX_VOICE_SAMPLES) {
    throw new ApiError('unprocessable', `A review takes at most ${MAX_VOICE_SAMPLES} voice samples.`, { field: 'file' });
  }

  const blobPath = writeManuscriptBlob(reviewId, `voice/sample-${existing.length + 1}.${extension ?? 'txt'}`, file.bytes);
  const voiceSampleId = insertVoiceSample(db, {
    reviewId,
    originalFilename: file.filename,
    mimeType: file.mimeType,
    blobPath,
    byteSize: file.bytes.byteLength,
    sha256,
  });

  return { voiceSampleId, sha256, byteSize: file.bytes.byteLength, count: existing.length + 1 };
}

async function extractText(bytes: Uint8Array, blobPath: string): Promise<string> {
  const lower = blobPath.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return extractPdfText(bytes);
  }
  if (lower.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return value;
  }
  return Buffer.from(bytes).toString('utf8');
}

export async function readVoiceSampleTexts(db: MaraDatabase, reviewId: string): Promise<string[]> {
  const rows = listVoiceSamples(db, reviewId);
  const texts: string[] = [];
  for (const row of rows) {
    const bytes = new Uint8Array(readFileSync(resolveRepoPath(row.blobPath)));
    const text = (await extractText(bytes, row.blobPath)).trim();
    if (text.length > 0) {
      texts.push(text);
    }
  }
  return texts;
}
