import { z } from 'zod';
import { findingSchema } from './finding';

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

export const fieldContextScoutSchema = z.object({
  queryVocabulary: z.array(z.string()),
  retrievalLog: z.array(retrievalLogEntrySchema),
  comparators: z.array(comparatorSchema),
  gapMap: z.string(),
  biasStatement: z.string(),
  benchmarks: z.array(benchmarkSchema),
  sourceAvailability: z.array(sourceAvailabilityItemSchema),
  findings: z.array(findingSchema),
});

export type FieldContextScoutOutput = z.infer<typeof fieldContextScoutSchema>;
