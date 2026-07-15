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

export interface Review {
  id: string;
  slug: string;
  title: string | null;
  status: ReviewStatus;
  currentPhase: string | null;
  recommendation: string | null;
  recommendationConfidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSummary {
  id: string;
  slug: string;
  title: string | null;
  status: ReviewStatus;
  currentPhase: string | null;
  createdAt: string;
  findingsCount: number;
  recommendation: string | null;
  rubricAverage: number | null;
}

export interface PhaseCheckpointView {
  phase: string;
  status: string;
  gateVerdict: string | null;
  fixCycleCount: number;
}

export interface ReviewDetail extends Review {
  severityCounts: Record<string, number>;
  checkpoints: PhaseCheckpointView[];
  rubricAverage: number | null;
}

export interface ReviewOptions {
  pauseAtGates?: boolean;
  lensOverrides?: string[];
  preset?: string;
}

export interface Detected {
  field: string;
  subfield?: string;
  studyDesign: string;
  manuscriptType: string;
  language: string;
  wordCount: number;
  sectionCount: number;
  referenceCount: number;
  hasAbstract: boolean;
  parseQuality: 'good' | 'degraded';
}

export interface Question {
  id: string;
  kind: 'confirm' | 'choice' | 'text' | 'multi';
  prompt: string;
  detectedValue?: string;
  options?: string[];
  default: string;
}

export interface QuestionsResponse {
  detected: Detected;
  questions: Question[];
}

export interface DeliverableView {
  kind: string;
  format: string;
  released: boolean;
  byteSize: number;
  checksum: string;
}

export interface RunStats {
  costUsd: number;
  costByPhase: Record<string, number>;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  retryRate: number;
  timeToFirstReviewMs: number | null;
}

export interface InstanceStats {
  costPerRun: number;
  completionRate: number;
  retryRate: number;
  timeToFirstReviewMs: number | null;
  runCount: number;
}

export interface ProviderKeyView {
  id: string;
  provider: string;
  label: string | null;
  maskedKey: string;
  baseUrl: string | null;
  persist: 'disk' | 'session';
}

export interface PersistedEvent {
  seq: number;
  event: string;
  data: unknown;
}
