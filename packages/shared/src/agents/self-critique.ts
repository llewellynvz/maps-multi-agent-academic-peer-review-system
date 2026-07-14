import { z } from 'zod';

export const selfCritiqueSchema = z.object({
  strongestObjection: z.string().min(1),
  confidenceRaisers: z.array(z.string().min(1)).min(1),
});

export type SelfCritique = z.infer<typeof selfCritiqueSchema>;
