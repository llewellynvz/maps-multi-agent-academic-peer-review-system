import { z } from 'zod';
import { findingIdSchema, findingSchema } from './finding';
import { selfCritiqueSchema } from './self-critique';

export const specialistReviewerSchema = z.object({
  lens: z.string(),
  coreContributionReading: z.string(),
  findings: z.array(findingSchema),
  challengeRound: z
    .object({
      updated: z.array(z.object({ id: findingIdSchema, evidenceThatChanged: z.string() })),
      dissentPreserved: z.array(z.object({ id: findingIdSchema, whyItHolds: z.string() })),
    })
    .nullable(),
  selfCritique: selfCritiqueSchema,
});

export type SpecialistReviewerOutput = z.infer<typeof specialistReviewerSchema>;
