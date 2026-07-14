import { z } from 'zod';

export const parseQualitySchema = z.enum(['good', 'degraded']);

export const parserSchema = z.enum(['grobid', 'unpdf', 'mammoth']);

export const manuscriptSectionSchema = z
  .object({
    index: z.number().int().nonnegative(),
    heading: z.string().nullable(),
    text: z.string(),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
  })
  .refine((section) => section.lineEnd >= section.lineStart, {
    message: 'lineEnd must be at least lineStart',
  });

export const manuscriptReferenceSchema = z.object({
  index: z.number().int().nonnegative(),
  raw: z.string(),
  title: z.string().nullable(),
  doi: z.string().nullable(),
  year: z.number().int().nullable(),
  venue: z.string().nullable().default(null),
  authors: z.array(z.string()),
});

export const sectionMapSchema = z.object({
  title: z.string().nullable(),
  abstract: z.string().nullable(),
  sections: z.array(manuscriptSectionSchema),
  references: z.array(manuscriptReferenceSchema),
  fullText: z.string(),
  parser: parserSchema,
  parseQuality: parseQualitySchema,
});

export type ParseQuality = z.infer<typeof parseQualitySchema>;
export type ManuscriptParser = z.infer<typeof parserSchema>;
export type ManuscriptSection = z.infer<typeof manuscriptSectionSchema>;
export type ManuscriptReference = z.infer<typeof manuscriptReferenceSchema>;
export type SectionMap = z.infer<typeof sectionMapSchema>;
