import type { Recommendation } from '@mara/shared';
import type { DeliverableJob, DeliverableMetadataRow } from './docx';
import { RECOMMENDATION_LABEL } from './private-notes';

export function confidenceBandPhrase(confidence: number): string {
  if (confidence >= 0.9) {
    return 'high confidence';
  }
  if (confidence >= 0.7) {
    return 'reasonable confidence';
  }
  return 'stated reservations';
}

export interface ReportJobInput {
  reviewTitle: string;
  manuscriptTitle: string | null;
  recommendation: Recommendation;
  confidence: number;
  rubricAverage: number;
  date: string;
  bodyMarkdown: string;
}

export function buildReportJob(input: ReportJobInput): DeliverableJob {
  const manuscript = input.manuscriptTitle ?? 'not extracted';
  const metadata: DeliverableMetadataRow[] = [
    { label: 'Manuscript', value: manuscript.length > 110 ? `${manuscript.slice(0, 107)}...` : manuscript, mono: false },
    { label: 'Recommendation', value: RECOMMENDATION_LABEL[input.recommendation], mono: false },
    { label: 'Confidence', value: confidenceBandPhrase(input.confidence), mono: false },
    { label: 'Rubric average', value: input.rubricAverage.toFixed(1), mono: true },
    { label: 'Date', value: input.date, mono: true },
  ];
  return {
    title: input.reviewTitle,
    kicker: 'Peer review',
    subtitle: `${RECOMMENDATION_LABEL[input.recommendation]}, held with ${confidenceBandPhrase(input.confidence)}.`,
    metadata,
    bodyMarkdown: input.bodyMarkdown,
    confidential: false,
  };
}

export interface NotesJobInput {
  reviewId: string;
  recommendation: Recommendation;
  confidence: number;
  date: string;
  bodyMarkdown: string;
}

export function buildNotesJob(input: NotesJobInput): DeliverableJob {
  return {
    title: "Reviewer's private notes",
    kicker: 'Editor-only',
    subtitle: 'Editorial signals and run audit for the handling editor.',
    metadata: [
      { label: 'Review', value: input.reviewId.slice(0, 8), mono: true },
      { label: 'Recommendation', value: RECOMMENDATION_LABEL[input.recommendation], mono: false },
      { label: 'Confidence', value: confidenceBandPhrase(input.confidence), mono: false },
      { label: 'Date', value: input.date, mono: true },
    ],
    bodyMarkdown: input.bodyMarkdown,
    confidential: true,
  };
}
