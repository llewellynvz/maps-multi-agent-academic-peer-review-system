import { z } from 'zod';

export const journalScopeFactorSchema = z.enum([
  'topic-fit',
  'article-type-compatibility',
  'methodological-approach-match',
  'contribution-type-alignment',
]);

export const journalScopeScorerSchema = z.object({
  score: z.number().min(0).max(1),
  factorsUsed: z.array(journalScopeFactorSchema),
  confidence: z.number().min(0).max(1),
  scopeTextAvailable: z.boolean(),
  noveltyPenaltyApplied: z.boolean(),
  rationale: z.string(),
});

export type JournalScopeScorerOutput = z.infer<typeof journalScopeScorerSchema>;
