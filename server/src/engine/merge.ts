import type { MaraDatabase } from '../db/client';
import { mergeFindings } from '../ledger';
import { artefactExists } from './artefacts';

export interface MergeOnceInput {
  reviewId: string;
  lensPrefix: string;
  phase: string;
  agent: string;
  fragments: unknown[];
  marker: string;
}

export function mergeFindingsOnce(db: MaraDatabase, input: MergeOnceInput): string[] {
  if (artefactExists(input.reviewId, `merge-${input.marker}`)) {
    return [];
  }
  const merged = mergeFindings(db, {
    reviewId: input.reviewId,
    lensPrefix: input.lensPrefix,
    phase: input.phase,
    agent: input.agent,
    fragments: input.fragments,
    marker: input.marker,
  });
  return merged.map((entry) => entry.id);
}
