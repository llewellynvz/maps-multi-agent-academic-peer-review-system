export type PaperType =
  | 'empirical'
  | 'theoretical'
  | 'review'
  | 'perspective-or-opinion'
  | 'methodological'
  | 'case-study';

export type Prior = 'accept' | 'minor-revision' | 'major-revision' | 'reject-and-resubmit' | 'reject';

export const PAPER_TYPES: PaperType[] = [
  'empirical',
  'theoretical',
  'review',
  'perspective-or-opinion',
  'methodological',
  'case-study',
];

export const PRIOR_VALUES: Prior[] = [
  'accept',
  'minor-revision',
  'major-revision',
  'reject-and-resubmit',
  'reject',
];

export interface IntakeOptions {
  reviewTitle: string | null;
  paperType: PaperType | null;
  referenceAudit: 'standard' | 'forensic';
  claimCheck: boolean;
  aiDetection: boolean;
  userPrior: Prior | null;
}

function answersOf(options: Record<string, unknown>): Record<string, unknown> {
  const answers = options.answers;
  return typeof answers === 'object' && answers !== null ? (answers as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function mapManuscriptTypeToPaperType(manuscriptType: string): PaperType {
  const token = manuscriptType.toLowerCase();
  if (token.includes('theor')) {
    return 'theoretical';
  }
  if (token.includes('perspective') || token.includes('opinion') || token.includes('commentary') || token.includes('editorial')) {
    return 'perspective-or-opinion';
  }
  if (token.includes('review') || token.includes('meta')) {
    return 'review';
  }
  if (token.includes('method')) {
    return 'methodological';
  }
  if (token.includes('case')) {
    return 'case-study';
  }
  return 'empirical';
}

export function readIntakeOptions(options: Record<string, unknown>): IntakeOptions {
  const answers = answersOf(options);
  const paperTypeRaw = asString(answers.paperType);
  const userPriorRaw = asString(answers.userPrior);
  return {
    reviewTitle: asString(answers.reviewTitle),
    paperType: paperTypeRaw !== null && (PAPER_TYPES as string[]).includes(paperTypeRaw) ? (paperTypeRaw as PaperType) : null,
    referenceAudit: answers.referenceAudit === 'forensic' ? 'forensic' : 'standard',
    claimCheck: answers.claimCheck === 'yes',
    aiDetection: answers.aiDetection !== 'no',
    userPrior: userPriorRaw !== null && (PRIOR_VALUES as string[]).includes(userPriorRaw) ? (userPriorRaw as Prior) : null,
  };
}
