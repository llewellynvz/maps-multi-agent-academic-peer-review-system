import { z } from 'zod';
import { findingSchema, severitySchema } from './finding';
import { selfCritiqueSchema } from './self-critique';

export const manuscriptSectionExtractSchema = z.object({
  heading: z.string(),
  anchor: z.string().min(1),
  statedAim: z.string().nullable(),
  hypotheses: z.array(z.string()),
  designSampleStatement: z.string().nullable(),
  headlineResults: z.array(z.string()),
  claimedContribution: z.string().nullable(),
});

export const sectionInventoryItemSchema = z.object({
  section: z.string(),
  status: z.enum(['present', 'absent', 'partial']),
});

export const declarationStatusSchema = z.enum(['present', 'absent', 'unclear', 'assumed-required']);

export const metadataDeclarationsSchema = z.object({
  ethicsApproval: declarationStatusSchema,
  consent: declarationStatusSchema,
  funding: declarationStatusSchema,
  conflictsOfInterest: declarationStatusSchema,
  dataAvailability: declarationStatusSchema,
  codeAvailability: declarationStatusSchema,
  preregistration: declarationStatusSchema,
  aiUseDisclosure: declarationStatusSchema,
});

export const figureTableItemSchema = z.object({
  id: z.string(),
  caption: z.string(),
  variableNames: z.array(z.string()),
  sampleSizes: z.array(z.string()),
  modelLabels: z.array(z.string()),
  citedInText: z.boolean(),
  mismatch: z.enum([
    'none',
    'labelling-change',
    'numerical-discrepancy',
    'missing-figure-or-table',
    'uncited-figure-or-table',
  ]),
  mismatchSeverity: severitySchema.nullable(),
});

export const ambiguityTypeSchema = z.enum([
  'undefined-construct',
  'scale-ambiguity',
  'causal-inflation',
  'scope-creep',
]);

export const ambiguityFindingSchema = z.object({
  type: ambiguityTypeSchema,
  anchor: z.string().min(1),
  description: z.string(),
});

export const manuscriptStructureSchema = z.object({
  mode: z.literal('A'),
  manuscriptMap: z.array(manuscriptSectionExtractSchema),
  sectionInventory: z.array(sectionInventoryItemSchema),
  metadataDeclarations: metadataDeclarationsSchema,
  figureTableInventory: z.array(figureTableItemSchema),
  ambiguityFindings: z.array(ambiguityFindingSchema),
  findings: z.array(findingSchema),
  selfCritique: selfCritiqueSchema,
});

export const claimSupportLevelSchema = z.enum(['direct', 'partial', 'indirect', 'absent', 'contradicted']);

export const claimEvidenceRowSchema = z.object({
  claim: z.string(),
  claimAnchor: z.string().min(1),
  evidence: z.string(),
  evidenceAnchor: z.string().min(1),
  supportLevel: claimSupportLevelSchema,
  material: z.boolean(),
  causal: z.boolean(),
});

export const studyDesignSchema = z.enum([
  'randomized-trial',
  'cohort',
  'case-control',
  'cross-sectional',
  'other-observational',
  'systematic-review-or-meta-analysis',
  'qualitative',
  'mixed-methods',
  'psychometric',
  'computational-or-simulation',
  'theory',
  'commentary',
  'case-study',
  'protocol',
]);

export const reportingGuidelineSchema = z.enum([
  'CONSORT',
  'PRISMA',
  'STROBE',
  'APA-JARS',
  'COREQ',
  'SRQR',
  'TRIPOD',
  'STARD',
  'ARRIVE',
  'SPIRIT',
  'journal-specific',
]);

export const reportingChecklistItemSchema = z.object({
  item: z.string(),
  originStandard: reportingGuidelineSchema,
  status: z.enum(['present', 'partially-present', 'absent', 'not-applicable']),
});

export const activationMapEntrySchema = z.object({
  lens: z.string(),
  active: z.boolean(),
  rationale: z.string(),
});

export const claimDesignAnalysisSchema = z.object({
  mode: z.literal('B'),
  claimEvidenceMatrix: z.array(claimEvidenceRowSchema),
  peripheralClaims: z.array(z.string()),
  studyDesign: studyDesignSchema,
  designConfidence: z.number().min(0).max(1),
  nearestAlternativeDesign: studyDesignSchema.nullable(),
  reportingGuidelines: z.array(reportingGuidelineSchema),
  reportingChecklist: z.array(reportingChecklistItemSchema),
  activationMap: z.array(activationMapEntrySchema),
  findings: z.array(findingSchema),
  selfCritique: selfCritiqueSchema,
});

export const manuscriptAnalystSchema = z.discriminatedUnion('mode', [
  manuscriptStructureSchema,
  claimDesignAnalysisSchema,
]);

export type ManuscriptStructure = z.infer<typeof manuscriptStructureSchema>;
export type ClaimDesignAnalysis = z.infer<typeof claimDesignAnalysisSchema>;
export type ManuscriptAnalystOutput = z.infer<typeof manuscriptAnalystSchema>;
