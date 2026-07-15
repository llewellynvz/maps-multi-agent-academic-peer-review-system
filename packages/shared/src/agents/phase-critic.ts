import { z } from 'zod';
import { selfCritiqueSchema } from './self-critique';

export const phaseCriticDefectKindSchema = z.enum([
  'missing-coverage',
  'generic-feedback',
  'evidence-discipline',
  'depth',
  'contradiction',
  'anchor-quality',
]);

export const phaseCriticDefectSchema = z.object({
  kind: phaseCriticDefectKindSchema,
  severity: z.enum(['note', 'material']),
  description: z.string().min(1),
  redispatchTarget: z.string().nullable(),
  fixInstruction: z.string().min(1),
});

export const phaseCriticSchema = z.object({
  verdict: z.enum(['clean', 'redispatch']),
  defects: z.array(phaseCriticDefectSchema),
  strongestGap: z.string().min(1),
  selfCritique: selfCritiqueSchema,
});

export type PhaseCriticDefect = z.infer<typeof phaseCriticDefectSchema>;
export type PhaseCriticOutput = z.infer<typeof phaseCriticSchema>;
