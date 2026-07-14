import { z } from 'zod';
import { findingIdSchema } from './finding';
import { recommendationSchema } from './recommendation';
import { selfCritiqueSchema } from './self-critique';

export const reviewMetaReviewerSchema = z.object({
  rubric: z
    .array(
      z.object({
        criterion: z.number().int().min(1).max(15),
        score: z.number().int().min(0).max(5),
        supportingIds: z.array(findingIdSchema).min(1),
        opposingIds: z.array(findingIdSchema),
      }),
    )
    .length(15),
  average: z.number(),
  bottlenecks: z.array(z.number().int()).length(3),
  recommendation: recommendationSchema,
  recommendationConfidence: z.number().min(0).max(1),
  scopeFit: z.object({ score: z.number(), factorsUsed: z.array(z.string()) }),
  decisionHinges: z.array(z.object({ findingId: findingIdSchema, hinge: z.string() })),
  selfCritique: selfCritiqueSchema,
});

export type ReviewMetaReviewerOutput = z.infer<typeof reviewMetaReviewerSchema>;
