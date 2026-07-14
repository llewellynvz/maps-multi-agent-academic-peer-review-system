import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import JSZip from 'jszip';
import type { MaraDatabase } from '../db/client';
import { deliverables, reviewEvents } from '../db/schema';
import { dataDir } from '../paths';
import { resolveRepoPath, sha256Hex } from '../workflow/storage';
import { ApiError } from './errors';
import { requireReview } from './reviews';
import type { DeliverableView } from './types';

export type DeliverableKind = 'peer_review_report' | 'reviewer_private_notes' | 'ledger_export' | 'run_archive';
export type DeliverableFormat = 'docx' | 'md' | 'zip';

const MIME: Record<DeliverableFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown; charset=utf-8',
  zip: 'application/zip',
};

const DEFAULT_FORMAT: Record<DeliverableKind, DeliverableFormat> = {
  peer_review_report: 'docx',
  reviewer_private_notes: 'docx',
  ledger_export: 'md',
  run_archive: 'zip',
};

function archivePath(reviewId: string): string {
  return resolve(dataDir(), 'deliverables', reviewId, 'Review-Archive.zip');
}

export function listDeliverables(db: MaraDatabase, reviewId: string): DeliverableView[] {
  requireReview(db, reviewId);
  const rows = db.select().from(deliverables).where(eq(deliverables.reviewId, reviewId)).all();
  const views: DeliverableView[] = rows.map((row) => ({
    kind: row.kind,
    format: row.format,
    released: row.released === 1,
    byteSize: row.byteSize,
    checksum: row.checksum,
  }));

  const anyReleased = rows.some((row) => row.released === 1);
  if (!views.some((view) => view.kind === 'run_archive')) {
    const cached = archivePath(reviewId);
    const exists = existsSync(cached);
    const bytes = exists ? readFileSync(cached) : null;
    views.push({
      kind: 'run_archive',
      format: 'zip',
      released: anyReleased,
      byteSize: bytes?.byteLength ?? 0,
      checksum: bytes !== null ? sha256Hex(bytes) : '',
    });
  }
  return views;
}

export interface DeliverableStream {
  bytes: Uint8Array;
  mime: string;
  filename: string;
}

export async function getDeliverable(
  db: MaraDatabase,
  reviewId: string,
  kind: DeliverableKind,
  format?: DeliverableFormat,
): Promise<DeliverableStream> {
  requireReview(db, reviewId);
  const resolvedFormat = format ?? DEFAULT_FORMAT[kind];

  if (kind === 'run_archive') {
    return buildRunArchive(db, reviewId);
  }

  const row = db
    .select()
    .from(deliverables)
    .where(eq(deliverables.reviewId, reviewId))
    .all()
    .find((candidate) => candidate.kind === kind && candidate.format === resolvedFormat);

  if (row === undefined) {
    throw new ApiError('not_found', `No ${kind} (${resolvedFormat}) deliverable for this review.`);
  }
  if (row.released === 0) {
    throw new ApiError('deliverable_not_released', 'This deliverable has not been released yet.');
  }
  const bytes = readFileSync(resolveRepoPath(row.path));
  if (sha256Hex(bytes) !== row.checksum) {
    throw new ApiError('internal', 'The deliverable on disk does not match its recorded checksum.');
  }
  return { bytes, mime: MIME[resolvedFormat], filename: `${kind}.${resolvedFormat}` };
}

async function buildRunArchive(db: MaraDatabase, reviewId: string): Promise<DeliverableStream> {
  const rows = db
    .select()
    .from(deliverables)
    .where(eq(deliverables.reviewId, reviewId))
    .all()
    .filter((row) => row.released === 1);
  if (rows.length === 0) {
    throw new ApiError('deliverable_not_released', 'The run archive is available once the review is released.');
  }

  const zip = new JSZip();
  for (const row of rows) {
    const path = resolveRepoPath(row.path);
    if (existsSync(path)) {
      zip.file(`${row.kind}.${row.format}`, readFileSync(path));
    }
  }

  const events = db.select().from(reviewEvents).where(eq(reviewEvents.reviewId, reviewId)).all();
  const audit = events
    .sort((a, b) => a.seq - b.seq)
    .map((event) => `${event.seq}\t${event.ts}\t${event.kind}\t${event.phase ?? ''}\t${event.payloadJson}`)
    .join('\n');
  zip.file('run-audit.tsv', `seq\tts\tkind\tphase\tpayload\n${audit}\n`);

  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const cached = archivePath(reviewId);
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, bytes);
  return { bytes, mime: MIME.zip, filename: 'run_archive.zip' };
}
