import type { MaraDatabase } from '../db/client';
import { ApiError } from './errors';
import { insertRunCommand } from './commands';
import { loadRawQuestions } from './questions';
import { requireReview, updateReviewTitle } from './reviews';

export interface SubmittedAnswer {
  questionId: string;
  value: string | string[];
}

export interface SubmitAnswersInput {
  answers: SubmittedAnswer[];
  useDefaults?: boolean;
}

const PRESETS = new Set(['fast', 'balanced', 'thorough']);

function flatten(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

export function submitAnswers(db: MaraDatabase, reviewId: string, input: SubmitAnswersInput): { accepted: true } {
  const review = requireReview(db, reviewId);
  if (review.status !== 'awaiting_input') {
    throw new ApiError('conflict', 'This review is not waiting for answers.', { status: review.status });
  }

  const raw = loadRawQuestions(reviewId);
  const byId = new Map(raw.map((question) => [question.id, question]));
  const answers: Record<string, string> = {};

  if (input.useDefaults === true) {
    for (const question of raw) {
      if (question.defaultValue !== null) {
        answers[question.field] = question.defaultValue;
      }
    }
  }

  for (const submitted of input.answers) {
    const question = byId.get(submitted.questionId);
    const key = question?.field ?? submitted.questionId;
    answers[key] = flatten(submitted.value);
  }

  if (typeof answers.reviewTitle === 'string' && answers.reviewTitle.trim().length > 0) {
    updateReviewTitle(db, reviewId, answers.reviewTitle.trim());
  }

  let preset: string | undefined;
  if (typeof answers.preset === 'string' && PRESETS.has(answers.preset)) {
    preset = answers.preset;
  }

  insertRunCommand(db, reviewId, 'resume', {
    trigger: 'clarify',
    answers,
    ...(preset !== undefined ? { preset } : {}),
  });

  return { accepted: true };
}
