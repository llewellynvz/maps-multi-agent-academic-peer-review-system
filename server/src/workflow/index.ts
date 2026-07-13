import type { Mastra } from '@mastra/core';

export interface IngestInput {
  reviewId: string;
  filePath: string;
  originalFilename: string;
  mimeType: string;
}

export interface IngestAnswers {
  answers: Record<string, string>;
  preset?: string;
}

export interface WorkflowRunSummary {
  runId: string;
  status: string;
  result: unknown;
}

export async function startIngest(mastra: Mastra, input: IngestInput): Promise<WorkflowRunSummary> {
  const workflow = mastra.getWorkflow('ingest');
  const run = await workflow.createRun();
  const result = await run.start({ inputData: input });
  return { runId: run.runId, status: result.status, result: (result as { result?: unknown }).result ?? null };
}

export async function resumeIngest(
  mastra: Mastra,
  runId: string,
  resumeData: IngestAnswers,
): Promise<WorkflowRunSummary> {
  const workflow = mastra.getWorkflow('ingest');
  const run = await workflow.createRun({ runId });
  const result = await run.resume({ resumeData, step: 'clarify' });
  return { runId, status: result.status, result: (result as { result?: unknown }).result ?? null };
}

export {
  buildIngestMastra,
  type BuildIngestMastraOptions,
  createIngestWorkflow,
  type IngestWorkflowDeps,
} from './ingest';
export {
  type ClarifyingQuestion,
  clarifyingQuestionSchema,
  liteParse,
  type LiteParseResult,
  type LiteParseOptions,
} from './lite-parse';
export { sanitizePhase, type SanitizePhaseOptions } from './sanitize-phase';
export {
  getCheckpoint,
  getManuscript,
  getReviewOptions,
  insertEvent,
  updateReview,
} from './repo';
export {
  type BuildReviewEngineMastraOptions,
  buildReviewEngineMastra,
  createReviewEngineWorkflow,
  type ReviewEngineDeps,
  type ReviewEngineRunSummary,
  startReviewEngine,
} from './review-engine';
