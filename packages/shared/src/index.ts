export type ReviewStatus =
  | 'created'
  | 'queued'
  | 'sanitizing'
  | 'running'
  | 'paused'
  | 'awaiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ReviewSummary {
  readonly id: string;
  readonly slug: string;
  readonly title: string | null;
  readonly status: ReviewStatus;
}
