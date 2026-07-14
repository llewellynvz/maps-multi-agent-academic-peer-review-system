import { z } from 'zod';
import { selfCritiqueSchema } from './self-critique';

export const qualityMetricsWeightsSchema = z.object({
  evidenceGroundingRate: z.literal(0.3),
  actionabilityIndex: z.literal(0.25),
  decisionStability: z.literal(0.2),
  toneRiskScore: z.literal(0.15),
  unsupportedClaimPenalty: z.literal(0.1),
});

export const qualityMetricsEngineSchema = z.object({
  evidenceGroundingRate: z.number().min(0).max(1),
  actionabilityIndex: z.number().min(0).max(1),
  decisionStability: z.number().min(0).max(1),
  toneRiskScore: z.number().min(0).max(1),
  unsupportedClaimCount: z.number().int().nonnegative(),
  weights: qualityMetricsWeightsSchema,
  composite: z.number().min(0).max(1),
  selfCritique: selfCritiqueSchema,
});

export type QualityMetricsEngineOutput = z.infer<typeof qualityMetricsEngineSchema>;
