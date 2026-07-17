import type { Recommendation } from '@mara/shared';
import type { GroundingFailureKind } from './grounding';

const NARROW_ORDER: Recommendation[] = [
  'accept',
  'minor_revision',
  'major_revision',
  'reject_and_resubmit',
  'reject',
];

export function narrowRecommendation(recommendation: Recommendation): Recommendation {
  const index = NARROW_ORDER.indexOf(recommendation);
  if (index < 0 || index >= NARROW_ORDER.length - 1) {
    return recommendation;
  }
  return NARROW_ORDER[index + 1] as Recommendation;
}

export type ArbitrationOutcome = 'accept-and-narrow' | 'overrule-with-named-evidence' | 'halt';

const HALT_KINDS = new Set<Exclude<GroundingFailureKind, null>>([
  'editor-only-leak',
  'banned-verdict-term',
  'ungrounded-id',
  'evidence-map-mismatch',
  'id-in-prose',
]);

export function groundingKindsForceHalt(kinds: Exclude<GroundingFailureKind, null>[]): boolean {
  return kinds.some((kind) => HALT_KINDS.has(kind));
}

export interface ArbitrationInput {
  objection: string;
  groundingFailureKinds: Exclude<GroundingFailureKind, null>[];
  confidentialityOrVerdictObjection: boolean;
  recommendation: Recommendation;
  decisionHingeIds: string[];
  ledgerIds: Set<string>;
  openFatalIds: string[];
  openMajorIds: string[];
}

export interface ArbitrationRecord {
  outcome: ArbitrationOutcome;
  objection: string;
  rationale: string;
  evidenceIds: string[];
  narrowedRecommendation: Recommendation | null;
}

export function arbitrate(input: ArbitrationInput): ArbitrationRecord {
  const forcedHalt =
    input.confidentialityOrVerdictObjection || groundingKindsForceHalt(input.groundingFailureKinds);
  if (forcedHalt) {
    return {
      outcome: 'halt',
      objection: input.objection,
      rationale:
        'Forced halt: the final cycle deliverable failed a substantive grounding, confidentiality, or verdict-term check that narrowing and overrule cannot resolve.',
      evidenceIds: [],
      narrowedRecommendation: null,
    };
  }

  const groundedHingeIds = input.decisionHingeIds.filter((id) => input.ledgerIds.has(id));
  if (groundedHingeIds.length === 0) {
    return {
      outcome: 'halt',
      objection: input.objection,
      rationale: 'The recommendation rationale cannot be grounded in any current ledger finding id.',
      evidenceIds: [],
      narrowedRecommendation: null,
    };
  }

  const fullyGrounded = groundedHingeIds.length === input.decisionHingeIds.length;
  if (fullyGrounded && input.openFatalIds.length === 0 && input.openMajorIds.length === 0) {
    return {
      outcome: 'overrule-with-named-evidence',
      objection: input.objection,
      rationale:
        'Every decision hinge resolves to a current ledger finding id and no open major or fatal finding contradicts the recommendation.',
      evidenceIds: groundedHingeIds,
      narrowedRecommendation: null,
    };
  }

  const bounding = input.openFatalIds.length > 0 ? input.openFatalIds : input.openMajorIds;
  const evidenceIds = bounding.length > 0 ? bounding : groundedHingeIds;
  return {
    outcome: 'accept-and-narrow',
    objection: input.objection,
    rationale:
      'The objection stands. The recommendation is narrowed to the category the open evidence supports, pulling down never up.',
    evidenceIds,
    narrowedRecommendation: narrowRecommendation(input.recommendation),
  };
}
