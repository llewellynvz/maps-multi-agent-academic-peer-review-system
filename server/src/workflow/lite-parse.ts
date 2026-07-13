import { z } from 'zod';
import type { SectionMap } from '@mara/shared';
import type { DetectDispatch } from '../sanitize';

export const clarifyingQuestionSchema = z.object({
  id: z.string(),
  kind: z.enum(['preset', 'metadata']),
  field: z.string(),
  prompt: z.string(),
  options: z.array(z.string()).optional(),
  defaultValue: z.string().nullable(),
});

export type ClarifyingQuestion = z.infer<typeof clarifyingQuestionSchema>;

export const provisionalMetadataSchema = z.object({
  field: z.string(),
  studyDesign: z.string(),
  manuscriptType: z.string(),
  language: z.string(),
  wordCountEstimate: z.number().int().nonnegative(),
});

export type ProvisionalMetadata = z.infer<typeof provisionalMetadataSchema>;

export interface DeterministicSummary {
  wordCount: number;
  sectionCount: number;
  referenceCount: number;
  hasTitle: boolean;
  hasAbstract: boolean;
}

export interface LiteParseResult {
  deterministic: DeterministicSummary;
  provisional: ProvisionalMetadata & { labelled: 'provisional' };
  questions: ClarifyingQuestion[];
}

export interface LiteParseOptions {
  sectionMap: SectionMap;
  runDispatch: DetectDispatch;
  reviewId: string;
  presetDefault?: string;
  journalProvided?: boolean;
}

const LITE_PARSE_SYSTEM = [
  'You classify a manuscript from its title, abstract, and opening section for a peer-review intake.',
  'Return a single provisional classification. Every value is provisional and may be overridden by the reviewer.',
  'Report the primary field, the study design, the manuscript type, the language as an ISO code, and an estimated word count.',
].join('\n');

function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

const PRESETS = ['fast', 'balanced', 'thorough'];

export async function liteParse(options: LiteParseOptions): Promise<LiteParseResult> {
  const { sectionMap } = options;
  const deterministic: DeterministicSummary = {
    wordCount: countWords(sectionMap.fullText),
    sectionCount: sectionMap.sections.length,
    referenceCount: sectionMap.references.length,
    hasTitle: sectionMap.title !== null && sectionMap.title.length > 0,
    hasAbstract: sectionMap.abstract !== null && sectionMap.abstract.length > 0,
  };

  const excerpt = sectionMap.fullText.slice(0, 6000);

  const dispatchResult = await options.runDispatch({
    reviewId: options.reviewId,
    phase: 'phase_1',
    agent: 'manuscript-analyst',
    promptVersion: 'lite-parse-pipe25-v1',
    role: 'cheap',
    schema: provisionalMetadataSchema,
    parts: { system: LITE_PARSE_SYSTEM, prompt: excerpt },
  });

  const parsed = provisionalMetadataSchema.safeParse(dispatchResult.object);
  const provisional: ProvisionalMetadata = parsed.success
    ? parsed.data
    : {
        field: 'unknown',
        studyDesign: 'unknown',
        manuscriptType: 'unknown',
        language: 'und',
        wordCountEstimate: deterministic.wordCount,
      };

  const presetDefault = PRESETS.includes(options.presetDefault ?? '') ? (options.presetDefault as string) : 'balanced';
  const questions: ClarifyingQuestion[] = [
    {
      id: 'preset',
      kind: 'preset',
      field: 'preset',
      prompt: 'Confirm the review depth preset for this manuscript.',
      options: PRESETS,
      defaultValue: presetDefault,
    },
    {
      id: 'field-confirm',
      kind: 'metadata',
      field: 'field',
      prompt: `Confirm the primary field (provisional classification: ${provisional.field}).`,
      defaultValue: provisional.field,
    },
  ];

  if (!deterministic.hasTitle) {
    questions.push({
      id: 'title',
      kind: 'metadata',
      field: 'title',
      prompt: 'The manuscript title could not be extracted. Provide the title.',
      defaultValue: null,
    });
  }
  if (options.journalProvided !== true) {
    questions.push({
      id: 'journal',
      kind: 'metadata',
      field: 'journal',
      prompt: 'Provide the target journal for this review.',
      defaultValue: null,
    });
  }

  return { deterministic, provisional: { ...provisional, labelled: 'provisional' }, questions };
}
