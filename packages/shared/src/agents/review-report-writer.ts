import { z } from 'zod';
import { findingIdSchema } from './finding';
import { recommendationSchema } from './recommendation';

export const rubricRowSchema = z.object({
  criterion: z.number().int().min(1).max(15),
  score: z.number().int().min(0).max(5),
  supportingIds: z.array(findingIdSchema).min(1),
});

export const fullReportEnvelopeSchema = z.object({
  mode: z.literal('A'),
  bodyMarkdown: z.string(),
  provisionalRubric: z.array(rubricRowSchema).length(15),
  provisionalAverage: z.number(),
  bottlenecks: z.array(z.number().int()).length(3),
  citedFindingIds: z.array(findingIdSchema),
});

export const shippedReportEnvelopeSchema = z.object({
  mode: z.literal('B'),
  recommendation: recommendationSchema,
  recommendationConfidence: z.number().min(0).max(1),
  bodyMarkdown: z.string(),
  rubricTable: z
    .array(
      z.object({
        criterion: z.number().int(),
        score: z.number().int(),
        justification: z.string(),
      }),
    )
    .length(15),
  references: z.array(z.string()),
  citedFindingIds: z.array(findingIdSchema),
  editorOnlyLeak: z.literal(false),
});

export const reviewReportWriterSchema = z.discriminatedUnion('mode', [
  fullReportEnvelopeSchema,
  shippedReportEnvelopeSchema,
]);

export type FullReportEnvelope = z.infer<typeof fullReportEnvelopeSchema>;
export type ShippedReportEnvelope = z.infer<typeof shippedReportEnvelopeSchema>;
export type ReviewReportWriterOutput = z.infer<typeof reviewReportWriterSchema>;
