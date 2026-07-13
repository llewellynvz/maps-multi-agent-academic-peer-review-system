import { normalizeDoi, titleSimilarity } from './text';
import type { CitationCandidate, CitationStatus, Reference } from './types';

export interface CandidateScore {
  status: CitationStatus;
  confidence: number;
}

const STRONG_TITLE = 0.82;
const LOOSE_TITLE = 0.5;

function clamp(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

export function scoreCandidate(reference: Reference, candidate: CitationCandidate): CandidateScore {
  const similarity = titleSimilarity(reference.title, candidate.title);
  const yearMatch = candidate.year !== undefined && Math.abs(candidate.year - reference.year) <= 1;
  const doiMatch =
    reference.doi !== undefined &&
    candidate.doi !== undefined &&
    normalizeDoi(reference.doi) === normalizeDoi(candidate.doi);

  if (doiMatch && similarity >= LOOSE_TITLE) {
    return { status: 'verified', confidence: clamp(0.9 + 0.1 * similarity) };
  }
  if (similarity >= STRONG_TITLE && yearMatch) {
    return { status: 'verified', confidence: clamp(0.55 + 0.4 * similarity) };
  }
  if (doiMatch) {
    return { status: 'mismatch', confidence: clamp(0.35 + 0.1 * similarity) };
  }
  if (similarity >= LOOSE_TITLE) {
    return { status: 'mismatch', confidence: clamp(0.2 + 0.4 * similarity) };
  }
  return { status: 'not_found', confidence: 0 };
}
