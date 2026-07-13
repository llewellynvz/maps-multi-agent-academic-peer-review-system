import type { MaraDatabase } from '../db/client';
import { mergeFindings } from '../ledger';
import { artefactExists, writeArtefact } from './artefacts';

export interface MergeOnceInput {
  reviewId: string;
  lensPrefix: string;
  phase: string;
  agent: string;
  fragments: unknown[];
  marker: string;
}

export function mergeFindingsOnce(db: MaraDatabase, input: MergeOnceInput): string[] {
  const markerName = `merge-${input.marker}`;
  if (artefactExists(input.reviewId, markerName)) {
    return [];
  }
  const merged = mergeFindings(db, {
    reviewId: input.reviewId,
    lensPrefix: input.lensPrefix,
    phase: input.phase,
    agent: input.agent,
    fragments: input.fragments,
  });
  writeArtefact(input.reviewId, markerName, { mergedIds: merged.map((entry) => entry.id), at: new Date().toISOString() });
  return merged.map((entry) => entry.id);
}
