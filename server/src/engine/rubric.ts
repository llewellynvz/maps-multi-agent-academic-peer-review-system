import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { rubricScores } from '../db/schema';

export interface RubricRowInput {
  criterionIndex: number;
  score: number;
  justifyingFindingIds: string[];
}

function upsertRubricScoreWithState(
  db: MaraDatabase,
  reviewId: string,
  input: RubricRowInput,
  state: 'provisional' | 'final',
): void {
  const ts = new Date().toISOString();
  const justifyingFindingIds = JSON.stringify(input.justifyingFindingIds);
  const existing = db
    .select()
    .from(rubricScores)
    .where(and(eq(rubricScores.reviewId, reviewId), eq(rubricScores.criterionIndex, input.criterionIndex)))
    .limit(1)
    .all()[0];

  if (existing !== undefined) {
    db.update(rubricScores)
      .set({ score: input.score, justifyingFindingIds, state, updatedAt: ts })
      .where(eq(rubricScores.id, existing.id))
      .run();
    return;
  }

  db.insert(rubricScores)
    .values({
      id: randomUUID(),
      reviewId,
      criterion: `Criterion ${input.criterionIndex}`,
      criterionIndex: input.criterionIndex,
      score: input.score,
      justifyingFindingIds,
      state,
      updatedAt: ts,
    })
    .run();
}

export function upsertRubricScore(db: MaraDatabase, reviewId: string, input: RubricRowInput): void {
  upsertRubricScoreWithState(db, reviewId, input, 'provisional');
}

export function upsertFinalRubricScore(db: MaraDatabase, reviewId: string, input: RubricRowInput): void {
  upsertRubricScoreWithState(db, reviewId, input, 'final');
}
