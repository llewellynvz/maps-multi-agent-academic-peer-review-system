import { z } from 'zod';
import { findingSchema } from './finding';

export const integrityRubricSchema = z.enum(['REV-RPT', 'REV-SIM', 'REV-AIC', 'REV-FIG', 'REV-CON', 'REV-RPX']);

export const integrityCheckOutcomeSchema = z.enum(['ran', 'not-applicable', 'not-run']);

export const integrityCheckResultSchema = z.object({
  rubric: integrityRubricSchema,
  outcome: integrityCheckOutcomeSchema,
  missingArtifact: z.string().nullable(),
});

export const integrityScreenerSchema = z.object({
  cluster: z.string(),
  checks: z.array(integrityCheckResultSchema),
  findings: z.array(findingSchema),
});

export type IntegrityScreenerOutput = z.infer<typeof integrityScreenerSchema>;
