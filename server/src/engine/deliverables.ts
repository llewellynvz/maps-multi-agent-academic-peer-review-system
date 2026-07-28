import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { deliverables } from '../db/schema';
import { sha256Hex, writeManuscriptBlob } from '../workflow/storage';

export type DeliverableKind = 'peer_review_report' | 'reviewer_private_notes' | 'ledger_export' | 'run_archive';
export type DeliverableFormat = 'docx' | 'md' | 'zip';

export interface PersistDeliverableInput {
  reviewId: string;
  kind: DeliverableKind;
  format: DeliverableFormat;
  relativePath: string;
  bytes: Uint8Array;
  released: boolean;
}

export function persistDeliverable(db: MaraDatabase, input: PersistDeliverableInput): string {
  const repoPath = writeManuscriptBlob(input.reviewId, input.relativePath, input.bytes);
  const checksum = sha256Hex(input.bytes);
  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(deliverables)
    .where(
      and(
        eq(deliverables.reviewId, input.reviewId),
        eq(deliverables.kind, input.kind),
        eq(deliverables.format, input.format),
      ),
    )
    .limit(1)
    .all()[0];

  if (existing !== undefined) {
    db.update(deliverables)
      .set({
        path: repoPath,
        checksum,
        byteSize: input.bytes.byteLength,
        released: input.released ? 1 : 0,
        releasedAt: input.released ? now : null,
      })
      .where(eq(deliverables.id, existing.id))
      .run();
    return repoPath;
  }

  db.insert(deliverables)
    .values({
      id: randomUUID(),
      reviewId: input.reviewId,
      kind: input.kind,
      format: input.format,
      path: repoPath,
      checksum,
      byteSize: input.bytes.byteLength,
      released: input.released ? 1 : 0,
      releasedAt: input.released ? now : null,
      createdAt: now,
    })
    .run();
  return repoPath;
}

// The download endpoint gates on the released flag alone, not on review status, so releasing before
// the phase-8 judges have run makes an author letter downloadable from a review that then fails.
export function releaseDeliverables(db: MaraDatabase, reviewId: string): void {
  db.update(deliverables)
    .set({ released: 1, releasedAt: new Date().toISOString() })
    .where(eq(deliverables.reviewId, reviewId))
    .run();
}
