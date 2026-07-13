import type { z } from 'zod';
import {
  citationAuditorSchema,
  claimDesignAnalysisSchema,
  fieldContextScoutSchema,
  fullReportEnvelopeSchema,
  integrityScreenerSchema,
  journalScopeScorerSchema,
  manuscriptSanitizerSchema,
  manuscriptStructureSchema,
  qualityMetricsEngineSchema,
  reviewCalibratorSchema,
  reviewFinalCriticSchema,
  reviewMetaReviewerSchema,
  shippedReportEnvelopeSchema,
  specialistReviewerSchema,
  swarmEvaluationSchema,
  swarmReportCritiqueSchema,
} from '@mara/shared';

export type SchemaResolver = (mode?: string) => z.ZodType;

const single =
  (schema: z.ZodType): SchemaResolver =>
  () =>
    schema;

const byMode =
  (map: Record<string, z.ZodType>): SchemaResolver =>
  (mode?: string) => {
    const key = mode ?? Object.keys(map)[0];
    const schema = key !== undefined ? map[key] : undefined;
    if (schema === undefined) {
      throw new Error(`No schema bound for mode ${mode ?? '(default)'}`);
    }
    return schema;
  };

const SCHEMA_RESOLVERS: Record<string, SchemaResolver> = {
  'manuscript-sanitizer': single(manuscriptSanitizerSchema),
  'manuscript-analyst': byMode({ A: manuscriptStructureSchema, B: claimDesignAnalysisSchema }),
  'field-context-scout': single(fieldContextScoutSchema),
  'citation-auditor': single(citationAuditorSchema),
  'specialist-reviewer': single(specialistReviewerSchema),
  'integrity-screener': single(integrityScreenerSchema),
  swarm: byMode({ A: swarmEvaluationSchema, B: swarmReportCritiqueSchema }),
  'review-report-writer': byMode({ A: fullReportEnvelopeSchema, B: shippedReportEnvelopeSchema }),
  'review-meta-reviewer': single(reviewMetaReviewerSchema),
  'review-final-critic': single(reviewFinalCriticSchema),
  'quality-metrics-engine': single(qualityMetricsEngineSchema),
  'journal-scope-scorer': single(journalScopeScorerSchema),
  'review-calibrator': single(reviewCalibratorSchema),
};

export const PHASE_0_6_ROSTER: string[] = [
  'manuscript-sanitizer',
  'manuscript-analyst',
  'field-context-scout',
  'citation-auditor',
  'specialist-reviewer',
  'integrity-screener',
  'swarm',
  'review-report-writer',
];

export const PHASE_7_8_ROSTER: string[] = [
  'review-meta-reviewer',
  'review-report-writer',
  'swarm',
  'review-final-critic',
  'quality-metrics-engine',
  'journal-scope-scorer',
  'review-calibrator',
];

export const FULL_ROSTER: string[] = [...PHASE_0_6_ROSTER, 'review-meta-reviewer', 'review-final-critic', 'quality-metrics-engine', 'journal-scope-scorer', 'review-calibrator'];

export function schemaFor(agentName: string, mode?: string): z.ZodType {
  const resolver = SCHEMA_RESOLVERS[agentName];
  if (resolver === undefined) {
    throw new Error(`No schema resolver registered for agent ${agentName}`);
  }
  return resolver(mode);
}

export function hasSchema(agentName: string): boolean {
  return SCHEMA_RESOLVERS[agentName] !== undefined;
}
