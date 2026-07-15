import { z } from 'zod';
import { findingSchema } from './finding';
import { selfCritiqueSchema } from './self-critique';

export const aiContentSignalKindSchema = z.enum([
  'stylometric',
  'phrasing-pattern',
  'uniformity',
  'reference-integrity',
  'disclosure',
]);

export const aiContentSignalStrengthSchema = z.enum(['none', 'low', 'moderate', 'serious']);

export const aiContentSignalSchema = z.object({
  kind: aiContentSignalKindSchema,
  anchor: z.string().min(1),
  strength: aiContentSignalStrengthSchema,
  falsePositiveCaveat: z.string().min(1),
});

export const aiContentAnalystSchema = z.object({
  signals: z.array(aiContentSignalSchema),
  disclosureCheck: z.string().min(1),
  notRun: z.array(z.string()),
  findings: z.array(findingSchema),
  selfCritique: selfCritiqueSchema,
});

export type AiContentSignalKind = z.infer<typeof aiContentSignalKindSchema>;
export type AiContentSignalStrength = z.infer<typeof aiContentSignalStrengthSchema>;
export type AiContentAnalystOutput = z.infer<typeof aiContentAnalystSchema>;
