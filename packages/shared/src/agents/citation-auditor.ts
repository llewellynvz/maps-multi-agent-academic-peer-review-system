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

export const claimSupportVerdictSchema = z.enum([
  'supports',
  'partially_supports',
  'does_not_support',
  'abstract_unavailable',
]);

export const citationClaimAssessmentSchema = z.object({
  referenceTitle: z.string(),
  claim: z.string(),
  support: claimSupportVerdictSchema,
  note: z.string(),
});

export const citationClaimsSchema = z.object({
  assessments: z.array(citationClaimAssessmentSchema),
  findings: z.array(findingSchema),
  selfCritique: selfCritiqueSchema,
});

export type ClaimSupportVerdict = z.infer<typeof claimSupportVerdictSchema>;
export type CitationClaimAssessment = z.infer<typeof citationClaimAssessmentSchema>;
export type CitationClaimsOutput = z.infer<typeof citationClaimsSchema>;
