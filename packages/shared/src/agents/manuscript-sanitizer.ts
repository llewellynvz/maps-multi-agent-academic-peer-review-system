import { z } from 'zod';
import { findingSchema } from './finding';
import { selfCritiqueSchema } from './self-critique';

export const quarantineTierSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const quarantineItemSchema = z.object({
  id: z.string(),
  tier: quarantineTierSchema,
  quote: z.string(),
  location: z.string(),
  reason: z.string(),
});

export const manuscriptSanitizerSchema = z.object({
  tier: quarantineTierSchema,
  halt: z.boolean(),
  sanitizedText: z.string(),
  quarantineLog: z.array(quarantineItemSchema),
  findings: z.array(findingSchema),
  rationale: z.string(),
  selfCritique: selfCritiqueSchema,
});

export type QuarantineTier = z.infer<typeof quarantineTierSchema>;
export type QuarantineItem = z.infer<typeof quarantineItemSchema>;
export type ManuscriptSanitizerOutput = z.infer<typeof manuscriptSanitizerSchema>;
