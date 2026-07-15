import type { EvidenceData, Question, QuestionsResponse } from './api';

export const INTAKE_SPECIAL_IDS = [
  'preset',
  'journal',
  'review-title',
  'paper-type',
  'reference-audit',
  'claim-check',
  'ai-detection',
  'user-prior',
] as const;

const SPECIAL = new Set<string>(INTAKE_SPECIAL_IDS);

export const NEW_INTAKE_IDS = new Set<string>([
  'review-title',
  'paper-type',
  'reference-audit',
  'claim-check',
  'ai-detection',
  'user-prior',
]);

export interface IntakeLayout {
  metadataQuestions: Question[];
  reviewTitle: Question | null;
  preset: Question | null;
  journal: Question | null;
  paperType: Question | null;
  referenceAudit: Question | null;
  claimCheck: Question | null;
  aiDetection: Question | null;
  userPrior: Question | null;
  showVerification: boolean;
  showAssessment: boolean;
}

function findQuestion(questions: Question[], id: string): Question | null {
  return questions.find((question) => question.id === id) ?? null;
}

export function resolveIntake(response: QuestionsResponse): IntakeLayout {
  const questions = response.questions;
  const referenceAudit = findQuestion(questions, 'reference-audit');
  const claimCheck = findQuestion(questions, 'claim-check');
  const aiDetection = findQuestion(questions, 'ai-detection');
  const userPrior = findQuestion(questions, 'user-prior');
  return {
    metadataQuestions: questions.filter((question) => !SPECIAL.has(question.id)),
    reviewTitle: findQuestion(questions, 'review-title'),
    preset: findQuestion(questions, 'preset'),
    journal: findQuestion(questions, 'journal'),
    paperType: findQuestion(questions, 'paper-type'),
    referenceAudit,
    claimCheck,
    aiDetection,
    userPrior,
    showVerification: referenceAudit !== null || claimCheck !== null || aiDetection !== null,
    showAssessment: userPrior !== null,
  };
}

export function resolveAnswer(question: Question, answers: Record<string, string>): string {
  return answers[question.id] ?? question.detectedValue ?? question.default;
}

export interface SubmitContext {
  answers: Record<string, string>;
  preset: string;
  journal: string;
  focus: string[];
  notes: string;
}

export function buildAnswersPayload(
  questions: Question[],
  context: SubmitContext,
): Array<{ questionId: string; value: string | string[] }> {
  const payload: Array<{ questionId: string; value: string | string[] }> = [];
  for (const question of questions) {
    if (question.id === 'preset') {
      payload.push({ questionId: 'preset', value: context.preset });
    } else if (question.id === 'journal') {
      payload.push({ questionId: 'journal', value: context.journal.length > 0 ? context.journal : 'None' });
    } else if (NEW_INTAKE_IDS.has(question.id)) {
      const resolved = resolveAnswer(question, context.answers);
      if (resolved.length > 0) {
        payload.push({ questionId: question.id, value: resolved });
      }
    } else if (context.answers[question.id] !== undefined) {
      payload.push({ questionId: question.id, value: context.answers[question.id] ?? '' });
    }
  }
  payload.push({ questionId: 'feedback_focus', value: context.focus });
  if (context.notes.length > 0) {
    payload.push({ questionId: 'notes', value: context.notes });
  }
  return payload;
}

export function humanizeOption(value: string): string {
  const spaced = value.replace(/-/g, ' ').trim();
  if (spaced.length === 0) {
    return value;
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function detectedTitle(response: QuestionsResponse): string | null {
  for (const id of ['review-title', 'title']) {
    const question = response.questions.find((candidate) => candidate.id === id);
    if (question?.detectedValue !== undefined && question.detectedValue.length > 0) {
      return question.detectedValue;
    }
  }
  return null;
}

export function parseQualitySentence(quality: 'good' | 'degraded'): string {
  return quality === 'degraded'
    ? 'Parts of the file did not read cleanly, so please check the detected values below before you start.'
    : 'The manuscript read cleanly and its structure came through intact.';
}

export function alignmentSentence(alignment: string): string {
  const key = alignment.trim().replace(/\s+/g, '-').toLowerCase();
  if (key === 'supported') {
    return 'The review evidence supports your preliminary assessment.';
  }
  if (key === 'partially-supported') {
    return 'The review evidence partly supports your preliminary assessment.';
  }
  if (key === 'contradicted') {
    return 'The review evidence runs against your preliminary assessment.';
  }
  return 'The review evidence has been weighed against your preliminary assessment.';
}

export function hasPriorStressTest(evidence: EvidenceData | null | undefined): boolean {
  const prior = evidence?.priorStressTest;
  return (
    prior !== null &&
    prior !== undefined &&
    typeof prior.prior === 'string' &&
    prior.prior.length > 0 &&
    typeof prior.caseFor === 'string' &&
    typeof prior.caseAgainst === 'string' &&
    typeof prior.alignment === 'string' &&
    Array.isArray(prior.hingeFindingIds)
  );
}
