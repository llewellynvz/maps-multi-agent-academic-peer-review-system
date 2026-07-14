import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { manuscripts, phaseCheckpoints, reviewEvents, reviews } from '../db/schema';
import { nowIso } from '../data/db';
import type { ReviewStatus } from '../data/types';

export type CheckpointStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export type EventKind =
  | 'phase_transition'
  | 'gate_verdict'
  | 'arbitration'
  | 'web_query'
  | 'control_ack'
  | 'deliverable_released'
  | 'finding_recorded'
  | 'run_terminal'
  | 'error';

export interface ManuscriptRow {
  id: string;
  reviewId: string;
  blobPath: string;
  teiStructurePath: string | null;
  sanitizedText: string | null;
  quarantineTier: number | null;
  quarantineLogJson: string | null;
}

export function getManuscript(db: MaraDatabase, reviewId: string): ManuscriptRow | undefined {
  const row = db.select().from(manuscripts).where(eq(manuscripts.reviewId, reviewId)).limit(1).all()[0];
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.id,
    reviewId: row.reviewId,
    blobPath: row.blobPath,
    teiStructurePath: row.teiStructurePath,
    sanitizedText: row.sanitizedText,
    quarantineTier: row.quarantineTier,
    quarantineLogJson: row.quarantineLogJson,
  };
}

export interface InsertManuscriptInput {
  reviewId: string;
  originalFilename: string;
  mimeType: string;
  blobPath: string;
  byteSize: number;
  sha256: string;
}

export function insertManuscript(db: MaraDatabase, input: InsertManuscriptInput): string {
  const id = randomUUID();
  db.insert(manuscripts)
    .values({
      id,
      reviewId: input.reviewId,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      blobPath: input.blobPath,
      byteSize: input.byteSize,
      sha256: input.sha256,
      ingestedAt: nowIso(),
    })
    .run();
  return id;
}

export function updateManuscript(
  db: MaraDatabase,
  reviewId: string,
  patch: Partial<{
    teiStructurePath: string;
    sanitizedText: string;
    quarantineTier: number | null;
    quarantineLogJson: string;
    sanitizedAt: string;
  }>,
): void {
  db.update(manuscripts).set(patch).where(eq(manuscripts.reviewId, reviewId)).run();
}

export interface CheckpointRow {
  id: string;
  status: CheckpointStatus;
  snapshot: unknown;
}

export function getCheckpoint(db: MaraDatabase, reviewId: string, phase: string): CheckpointRow | undefined {
  const row = db
    .select()
    .from(phaseCheckpoints)
    .where(and(eq(phaseCheckpoints.reviewId, reviewId), eq(phaseCheckpoints.phase, phase)))
    .limit(1)
    .all()[0];
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.id,
    status: row.status as CheckpointStatus,
    snapshot: row.snapshotJson !== null ? JSON.parse(row.snapshotJson) : null,
  };
}

export function upsertCheckpoint(
  db: MaraDatabase,
  input: { reviewId: string; phase: string; status: CheckpointStatus; snapshot?: unknown },
): void {
  const ts = nowIso();
  const snapshotJson = input.snapshot !== undefined ? JSON.stringify(input.snapshot) : undefined;
  const existing = db
    .select()
    .from(phaseCheckpoints)
    .where(and(eq(phaseCheckpoints.reviewId, input.reviewId), eq(phaseCheckpoints.phase, input.phase)))
    .limit(1)
    .all()[0];

  if (existing !== undefined) {
    db.update(phaseCheckpoints)
      .set({
        status: input.status,
        ...(snapshotJson !== undefined ? { snapshotJson } : {}),
        completedAt: input.status === 'completed' ? ts : existing.completedAt,
        updatedAt: ts,
      })
      .where(eq(phaseCheckpoints.id, existing.id))
      .run();
    return;
  }

  db.insert(phaseCheckpoints)
    .values({
      id: randomUUID(),
      reviewId: input.reviewId,
      phase: input.phase,
      status: input.status,
      fixCycleCount: 0,
      snapshotJson: snapshotJson ?? null,
      startedAt: ts,
      completedAt: input.status === 'completed' ? ts : null,
      updatedAt: ts,
    })
    .run();
}

export function recordGateCheckpoint(
  db: MaraDatabase,
  input: {
    reviewId: string;
    phase: string;
    status: CheckpointStatus;
    gateVerdict: 'pass' | 'revise' | 'revise_specialist' | 'block' | 'arbitrated';
    fixCycleCount: number;
    snapshot?: unknown;
  },
): void {
  const ts = nowIso();
  const snapshotJson = input.snapshot !== undefined ? JSON.stringify(input.snapshot) : undefined;
  const existing = db
    .select()
    .from(phaseCheckpoints)
    .where(and(eq(phaseCheckpoints.reviewId, input.reviewId), eq(phaseCheckpoints.phase, input.phase)))
    .limit(1)
    .all()[0];

  if (existing !== undefined) {
    db.update(phaseCheckpoints)
      .set({
        status: input.status,
        gateVerdict: input.gateVerdict,
        fixCycleCount: input.fixCycleCount,
        ...(snapshotJson !== undefined ? { snapshotJson } : {}),
        completedAt: input.status === 'completed' ? ts : existing.completedAt,
        updatedAt: ts,
      })
      .where(eq(phaseCheckpoints.id, existing.id))
      .run();
    return;
  }

  db.insert(phaseCheckpoints)
    .values({
      id: randomUUID(),
      reviewId: input.reviewId,
      phase: input.phase,
      status: input.status,
      gateVerdict: input.gateVerdict,
      fixCycleCount: input.fixCycleCount,
      snapshotJson: snapshotJson ?? null,
      startedAt: ts,
      completedAt: input.status === 'completed' ? ts : null,
      updatedAt: ts,
    })
    .run();
}

export function insertEvent(
  db: MaraDatabase,
  input: {
    reviewId: string;
    kind: EventKind;
    phase?: string;
    payload?: unknown;
    egressTarget?: string | null;
    egressQuery?: string | null;
  },
): number {
  return db.transaction(
    (tx) => {
      const rows = tx
        .select({ seq: reviewEvents.seq })
        .from(reviewEvents)
        .where(eq(reviewEvents.reviewId, input.reviewId))
        .all();
      const nextSeq = rows.reduce((max, row) => (row.seq > max ? row.seq : max), 0) + 1;
      tx.insert(reviewEvents)
        .values({
          id: randomUUID(),
          reviewId: input.reviewId,
          seq: nextSeq,
          ts: nowIso(),
          kind: input.kind,
          phase: input.phase ?? null,
          payloadJson: JSON.stringify(input.payload ?? {}),
          egressTarget: input.egressTarget ?? null,
          egressQuery: input.egressQuery ?? null,
        })
        .run();
      return nextSeq;
    },
    { behavior: 'immediate' },
  );
}

export type ReviewStatusValue = ReviewStatus;

export function updateReview(
  db: MaraDatabase,
  reviewId: string,
  patch: Partial<{
    status: ReviewStatusValue;
    currentPhase: string;
    startedAt: string;
    errorClass: string;
    recommendation: string;
    recommendationConfidence: number;
    completedAt: string;
  }>,
): void {
  db.update(reviews)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(reviews.id, reviewId))
    .run();
}

export function getReviewOptions(db: MaraDatabase, reviewId: string): Record<string, unknown> {
  const row = db.select({ optionsJson: reviews.optionsJson }).from(reviews).where(eq(reviews.id, reviewId)).limit(1).all()[0];
  if (row === undefined) {
    return {};
  }
  try {
    return JSON.parse(row.optionsJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function mergeReviewOptions(db: MaraDatabase, reviewId: string, patch: Record<string, unknown>): void {
  const current = getReviewOptions(db, reviewId);
  const merged = { ...current, ...patch };
  db.update(reviews)
    .set({ optionsJson: JSON.stringify(merged), updatedAt: nowIso() })
    .where(eq(reviews.id, reviewId))
    .run();
}
