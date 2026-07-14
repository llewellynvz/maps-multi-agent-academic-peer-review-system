import { z } from 'zod';
import { findingIdSchema, findingSchema } from './finding';
import { recommendationSchema } from './recommendation';
import { selfCritiqueSchema } from './self-critique';

export const swarmRoleSchema = z.enum([
  'seed-constructor',
  'population-generator',
  'interaction-moderator',
  'local-reviewer-fish',
  'consensus-dissent-analyst',
  'bias-herding-monitor',
  'report-evaluator',
]);

export const blindSpotSchema = z.enum([
  'dismisses-unconventional-methods',
  'approves-familiar-methods-despite-violations',
  'misses-construct-drift',
  'over-weights-writing-quality',
  'anchor-bias-first-finding',
]);

export const recommendationDistributionRowSchema = z.object({
  recommendation: recommendationSchema,
  round0Count: z.number().int().nonnegative(),
  finalCount: z.number().int().nonnegative(),
});

export const findingStabilitySchema = z.object({
  findingId: findingIdSchema,
  classification: z.enum(['stable', 'fragile']),
  roundSupport: z.array(z.number().min(0).max(1)),
});

export const swarmEvaluationSchema = z.object({
  mode: z.literal('A'),
  populationSize: z.number().int().min(12).max(48),
  topology: z.enum(['ring', 'small-world', 'stratified', 'adversarial']),
  recommendationDistribution: z.array(recommendationDistributionRowSchema),
  consensusEntropy: z.number().min(0),
  decisionStability: z.number().min(0).max(1),
  stableFindings: z.array(findingStabilitySchema),
  fragileFindings: z.array(findingStabilitySchema),
  strongestMinorityReport: z.string(),
  herdingRisk: z.enum(['low', 'moderate', 'high']),
  surfacedFindings: z.array(findingSchema),
  selfCritique: selfCritiqueSchema,
});

export const swarmReportCritiqueItemSchema = z.object({
  defectType: z.enum([
    'unsupported-or-overstated',
    'missing-major-concern',
    'anchoring-on-dispatch-order',
    'unfair-strengths-section',
  ]),
  reportLine: z.string(),
  findingId: findingIdSchema.nullable(),
  recommendation: z.string(),
});

export const swarmReportCritiqueSchema = z.object({
  mode: z.literal('B'),
  critique: z.array(swarmReportCritiqueItemSchema),
  selfCritique: selfCritiqueSchema,
});

export const swarmSchema = z.discriminatedUnion('mode', [swarmEvaluationSchema, swarmReportCritiqueSchema]);

export type SwarmEvaluation = z.infer<typeof swarmEvaluationSchema>;
export type SwarmReportCritique = z.infer<typeof swarmReportCritiqueSchema>;
export type SwarmOutput = z.infer<typeof swarmSchema>;
