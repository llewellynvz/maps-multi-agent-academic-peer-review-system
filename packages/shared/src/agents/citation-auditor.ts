import { z } from 'zod';
import { findingSchema } from './finding';
import { selfCritiqueSchema } from './self-critique';

export const citationClassificationSchema = z.enum([
  'confirmed',
  'partially-confirmed',
  'unverifiable',
  'possible-fabrication',
]);

export const citationVerificationSchema = z.object({
  referenceIndex: z.number().int().nonnegative(),
  citation: z.string(),
  toolsChecked: z.array(z.string()),
  classification: citationClassificationSchema,
  supportNote: z.string().nullable(),
});

export const weakSourceFlagSchema = z.object({
  referenceIndex: z.number().int().nonnegative(),
  reason: z.string(),
  strongerAlternative: z.string().nullable(),
});

export const citationAuditorSchema = z.object({
  samplingStrategy: z.string(),
  totalCoverage: z.number().min(0).max(1),
  verifications: z.array(citationVerificationSchema),
  weakSourceFlags: z.array(weakSourceFlagSchema),
  hygieneFindings: z.array(z.string()),
  findings: z.array(findingSchema),
  selfCritique: selfCritiqueSchema,
});

export type CitationAuditorOutput = z.infer<typeof citationAuditorSchema>;
