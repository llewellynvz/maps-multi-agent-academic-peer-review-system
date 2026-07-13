import { z } from 'zod';

export const calibrationModeSchema = z.enum(['journal-specific', 'cross-journal-fallback']);

export const reviewCalibratorSchema = z
  .object({
    mode: calibrationModeSchema,
    completedReviewsForJournal: z.number().int().nonnegative(),
    journalSpecificThresholdMet: z.boolean(),
    benchmarkComparison: z.string(),
    drift: z.array(z.object({ metric: z.string(), observed: z.string(), benchmark: z.string() })),
  })
  .refine((report) => report.journalSpecificThresholdMet === report.completedReviewsForJournal >= 10, {
    message: 'journalSpecificThresholdMet must equal (completedReviewsForJournal >= 10) per AGENT-20',
    path: ['journalSpecificThresholdMet'],
  })
  .refine((report) => report.journalSpecificThresholdMet || report.mode === 'cross-journal-fallback', {
    message: 'mode must be cross-journal-fallback below the ten-review threshold (AGENT-20)',
    path: ['mode'],
  });

export type ReviewCalibratorOutput = z.infer<typeof reviewCalibratorSchema>;
