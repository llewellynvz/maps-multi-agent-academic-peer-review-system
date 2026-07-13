import { z } from 'zod';

export const recommendationSchema = z.enum([
  'accept',
  'minor_revision',
  'major_revision',
  'reject_and_resubmit',
  'reject',
]);

export type Recommendation = z.infer<typeof recommendationSchema>;
