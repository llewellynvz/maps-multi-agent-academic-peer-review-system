import { z } from 'zod';
import { findingSchema } from './finding';
import { selfCritiqueSchema } from './self-critique';

export const retrievalLogEntrySchema = z.object({
  query: z.string(),
  source: z.string(),
  date: z.string(),
  resultsReviewed: z.number().int().nonnegative(),
  resultsIncluded: z.number().int().nonnegative(),
  rationale: z.string(),
});

export const comparatorSchema = z.object({
  citation: z.string(),
  relevance: z.string(),
});

export const benchmarkSchema = z.object({
  metric: z.string(),
  value: z.string(),
  source: z.string(),
  tension: z.string().nullable(),
});

export const linkStabilitySchema = z.enum(['stable', 'redirectable', 'fragile']);

export const sourceAvailabilityItemSchema = z.object({
  url: z.string(),
  dateAccessed: z.string(),
  summary: z.string(),
  stability: linkStabilitySchema,
  broken: z.boolean(),
});

export const topicQuerySchema = z.object({
  query: z.string().min(3),
  purpose: z.string().min(1),
});

export const scoutPlanSchema = z.object({
  mode: z.literal('plan'),
  queryVocabulary: z.array(z.string()).min(1),
  topicQueries: z.array(topicQuerySchema).min(3).max(8),
  selfCritique: selfCritiqueSchema,
});

export const keyPaperSchema = z.object({
  citation: z.string(),
  whyItMatters: z.string(),
});

export const fieldContextScoutSchema = z.object({
  queryVocabulary: z.array(z.string()),
  retrievalLog: z.array(retrievalLogEntrySchema),
  comparators: z.array(comparatorSchema),
  keyPapers: z.array(keyPaperSchema).max(15),
  contestedClaims: z.array(z.string()),
  recentReviews: z.array(z.string()),
  methodNorms: z.array(z.string()),
  gapMap: z.string(),
  biasStatement: z.string(),
  benchmarks: z.array(benchmarkSchema),
  sourceAvailability: z.array(sourceAvailabilityItemSchema),
  findings: z.array(findingSchema),
  selfCritique: selfCritiqueSchema,
});

export type TopicQuery = z.infer<typeof topicQuerySchema>;
export type ScoutPlan = z.infer<typeof scoutPlanSchema>;
export type KeyPaper = z.infer<typeof keyPaperSchema>;
export type FieldContextScoutOutput = z.infer<typeof fieldContextScoutSchema>;
