import { z } from 'zod';
import { findingIdSchema } from './finding';
import { selfCritiqueSchema } from './self-critique';

export const priorAlignmentSchema = z.enum(['supported', 'partially_supported', 'contradicted']);

export const priorStressTestSchema = z.object({
  caseFor: z.string().min(1),
  caseAgainst: z.string().min(1),
  alignment: priorAlignmentSchema,
  hingeFindingIds: z.array(findingIdSchema).min(1),
  selfCritique: selfCritiqueSchema,
});

export type PriorAlignment = z.infer<typeof priorAlignmentSchema>;
export type PriorStressTestOutput = z.infer<typeof priorStressTestSchema>;
