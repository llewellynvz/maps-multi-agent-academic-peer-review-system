export {
  type ManuscriptParser,
  type ManuscriptReference,
  type ManuscriptSection,
  manuscriptReferenceSchema,
  manuscriptSectionSchema,
  type ParseQuality,
  parseQualitySchema,
  parserSchema,
  type SectionMap,
  sectionMapSchema,
} from './section-map';

export * from './agents/finding';
export * from './agents/recommendation';
export * from './agents/self-critique';
export * from './agents/manuscript-sanitizer';
export * from './agents/manuscript-analyst';
export * from './agents/field-context-scout';
export * from './agents/citation-auditor';
export * from './agents/specialist-reviewer';
export * from './agents/integrity-screener';
export * from './agents/ai-content-analyst';
export * from './agents/prior-stress-test';
export * from './agents/swarm';
export * from './agents/review-report-writer';
export * from './agents/review-meta-reviewer';
export * from './agents/review-final-critic';
export * from './agents/phase-critic';
export * from './agents/journal-scope-scorer';
export * from './agents/quality-metrics-engine';
export * from './agents/review-calibrator';
export * from './agents/voice-profiler';

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
