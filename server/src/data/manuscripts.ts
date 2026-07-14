import { and, eq } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { manuscripts } from '../db/schema';
import { insertManuscript } from '../workflow/repo';
import { sha256Hex, writeManuscriptBlob } from '../workflow/storage';
import { ApiError } from './errors';
import { insertRunCommand } from './commands';
import { requireReview } from './reviews';

const ACCEPTED = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

function extensionFor(mimeType: string, filename: string): 'pdf' | 'docx' {
  if (mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
    return 'pdf';
  }
  return 'docx';
}

export interface UploadResult {
  manuscriptId: string;
  sha256: string;
  byteSize: number;
  quarantine: 'pending';
}

export function uploadManuscript(
  db: MaraDatabase,
  reviewId: string,
  file: { bytes: Uint8Array; filename: string; mimeType: string },
): UploadResult {
  requireReview(db, reviewId);

  if (!ACCEPTED.has(file.mimeType) && !/\.(pdf|docx)$/i.test(file.filename)) {
    throw new ApiError('unprocessable', 'Upload a PDF or DOCX manuscript.', { field: 'file', mimeType: file.mimeType });
  }

  const sha256 = sha256Hex(file.bytes);
  const existing = db.select().from(manuscripts).where(eq(manuscripts.reviewId, reviewId)).limit(1).all()[0];
  if (existing !== undefined) {
    if (existing.sha256 === sha256) {
      return { manuscriptId: existing.id, sha256, byteSize: existing.byteSize, quarantine: 'pending' };
    }
    throw new ApiError('manuscript_already_exists', 'This review already holds a manuscript.');
  }

  const extension = extensionFor(file.mimeType, file.filename);
  const blobPath = writeManuscriptBlob(reviewId, `manuscript/original.${extension}`, file.bytes);
  const manuscriptId = insertManuscript(db, {
    reviewId,
    originalFilename: file.filename,
    mimeType: file.mimeType,
    blobPath,
    byteSize: file.bytes.byteLength,
    sha256,
  });

  insertRunCommand(db, reviewId, 'run', { trigger: 'ingest', filePath: blobPath, kind: extension, originalFilename: file.filename, mimeType: file.mimeType });

  return { manuscriptId, sha256, byteSize: file.bytes.byteLength, quarantine: 'pending' };
}

export function hasManuscript(db: MaraDatabase, reviewId: string): boolean {
  return db.select().from(manuscripts).where(and(eq(manuscripts.reviewId, reviewId))).limit(1).all().length > 0;
}
