import { z } from 'zod';
import { findingIdSchema } from './finding';
import { selfCritiqueSchema } from './self-critique';

export const criticVerdictKindSchema = z.enum(['pass', 'revise', 'revise-specialist', 'block']);

export const reviewFinalCriticSchema = z
  .object({
    verdict: criticVerdictKindSchema,
    lens: z.string().nullable(),
    sectionsToRework: z.array(z.string()),
    findingIdToSupersede: findingIdSchema.nullable(),
    failureConstructionAttempt: z.string(),
    escalatedInconsistencies: z.array(z.string()),
    mostDangerousDefect: z.string().nullable(),
    selfCritique: selfCritiqueSchema,
  })
  .refine((verdict) => verdict.verdict !== 'revise-specialist' || verdict.lens !== null, {
    message: 'a revise-specialist verdict must name the lens (PRD 5.6 gate machinery)',
    path: ['lens'],
  });

export type ReviewFinalCriticOutput = z.infer<typeof reviewFinalCriticSchema>;
