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
  // An unextracted year arrives as 0, so comparing it arithmetically turns "we do not know the year"
  // into a conflict and downgrades an otherwise exact title match to a mismatch.
  const referenceYearKnown = Number.isFinite(reference.year) && reference.year > 0;
  const yearMatch = candidate.year !== undefined && referenceYearKnown && Math.abs(candidate.year - reference.year) <= 1;
  const yearConflict = candidate.year !== undefined && referenceYearKnown && !yearMatch;
  const doiMatch =
    reference.doi !== undefined &&
    candidate.doi !== undefined &&
    normalizeDoi(reference.doi) === normalizeDoi(candidate.doi);
  // A near-identical title is not enough when the candidate carries a year we cannot check against:
  // sibling papers ("... Part I" and "... Part II") clear the strong threshold, and confirming the
  // wrong source is worse than failing to confirm the right one. A candidate with no year at all still
  // verifies on title strength, which is the behaviour pinned by "verifies a strong title match when
  // the backend record has no year".
  const corroborated = doiMatch || yearMatch || candidate.year === undefined;

  if (doiMatch && similarity >= LOOSE_TITLE) {
    return { status: 'verified', confidence: clamp(0.9 + 0.1 * similarity) };
  }
  if (similarity >= STRONG_TITLE && !yearConflict && corroborated) {
    return { status: 'verified', confidence: clamp(0.55 + 0.4 * similarity - (yearMatch ? 0 : 0.1)) };
  }
  if (doiMatch) {
    return { status: 'mismatch', confidence: clamp(0.35 + 0.1 * similarity) };
  }
  if (similarity >= LOOSE_TITLE) {
    return { status: 'mismatch', confidence: clamp(0.2 + 0.4 * similarity) };
  }
  return { status: 'not_found', confidence: 0 };
}
