import { z } from 'zod';

export const bandSchema = z.enum(['Green', 'Yellow', 'Red']);

export const epistemicStatusSchema = z.enum(['Known', 'Inferred', 'Assumption']);

export const severitySchema = z.enum(['none', 'minor', 'moderate', 'major', 'fatal']);

export const fixabilitySchema = z.enum([
  'easy',
  'moderate',
  'hard',
  'not-fixable-from-current-study',
  'unclear',
]);

export const findingScopeSchema = z.enum(['author-facing', 'editor-only', 'both']);

export const findingIdSchema = z.string().regex(/^REV-[A-Z]{3,4}-\d{4}$/);

function bandMatchesConfidence(band: z.infer<typeof bandSchema>, confidence: number): boolean {
  if (band === 'Green') {
    return confidence >= 0.98 && confidence <= 1;
  }
  if (band === 'Yellow') {
    return confidence >= 0.7 && confidence < 0.98;
  }
  return confidence < 0.7;
}

export const findingSchema = z
  .object({
    id: findingIdSchema,
    lens: z.string(),
    phase: z.number().int(),
    claim: z.string(),
    anchor: z.string().min(1),
    epistemic: epistemicStatusSchema,
    confidence: z.number().min(0).max(1),
    band: bandSchema,
    severity: severitySchema,
    fixability: fixabilitySchema,
    scope: findingScopeSchema,
    failureScenario: z.string(),
    leanestFix: z.string(),
    supersedes: z.string().nullable(),
  })
  .refine((finding) => bandMatchesConfidence(finding.band, finding.confidence), {
    message: 'band must match confidence per knowledge/01 (Green 0.98-1.00, Yellow 0.70-<0.98, Red <0.70)',
    path: ['band'],
  });

export type Band = z.infer<typeof bandSchema>;
export type EpistemicStatus = z.infer<typeof epistemicStatusSchema>;
export type Severity = z.infer<typeof severitySchema>;
export type Fixability = z.infer<typeof fixabilitySchema>;
export type FindingScope = z.infer<typeof findingScopeSchema>;
export type Finding = z.infer<typeof findingSchema>;
