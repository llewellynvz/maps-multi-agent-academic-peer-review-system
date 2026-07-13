import { Mastra } from '@mastra/core';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { LibSQLStore } from '@mastra/libsql';
import { z } from 'zod';
import type { CitationClient } from '../citations';
import type { MaraDatabase } from '../db/client';
import {
  type EngineDeps,
  runPhase1,
  runPhase2,
  runPhase3,
  runPhase4,
  runPhase5,
  runPhase6,
  runPhase7,
  runPhase8,
} from '../engine';
import type { DispatchRunner } from '../providers';

export interface ReviewEngineDeps {
  db: MaraDatabase;
  runDispatch: DispatchRunner;
  citationClient?: CitationClient;
}

const engineIo = z.object({ reviewId: z.string() });

type PhaseRunner = (deps: EngineDeps, reviewId: string) => Promise<void>;

export function createReviewEngineWorkflow(deps: ReviewEngineDeps) {
  const engineDeps: EngineDeps = {
    db: deps.db,
    runDispatch: deps.runDispatch,
    ...(deps.citationClient !== undefined ? { citationClient: deps.citationClient } : {}),
  };

  const phaseStep = (id: string, run: PhaseRunner) =>
    createStep({
      id,
      inputSchema: engineIo,
      outputSchema: engineIo,
      execute: async ({ inputData }) => {
        await run(engineDeps, inputData.reviewId);
        return { reviewId: inputData.reviewId };
      },
    });

  return createWorkflow({ id: 'review-engine', inputSchema: engineIo, outputSchema: engineIo })
    .then(phaseStep('phase-1-analysis', runPhase1))
    .then(phaseStep('phase-2-context', runPhase2))
    .then(phaseStep('phase-3-specialist', runPhase3))
    .then(phaseStep('phase-4-integrity', runPhase4))
    .then(phaseStep('phase-5-swarm', runPhase5))
    .then(phaseStep('phase-6-report', runPhase6))
    .then(phaseStep('phase-7-release-gate', runPhase7))
    .then(phaseStep('phase-8-production', runPhase8))
    .commit();
}

export interface BuildReviewEngineMastraOptions extends ReviewEngineDeps {
  mastraDbPath: string;
}

export function buildReviewEngineMastra(options: BuildReviewEngineMastraOptions): Mastra {
  const workflow = createReviewEngineWorkflow(options);
  const url = `file:${options.mastraDbPath.split('\\').join('/')}`;
  return new Mastra({
    storage: new LibSQLStore({ id: 'mara-review-engine-storage', url }),
    workflows: { 'review-engine': workflow },
  });
}

export interface ReviewEngineRunSummary {
  runId: string;
  status: string;
}

export async function startReviewEngine(mastra: Mastra, reviewId: string): Promise<ReviewEngineRunSummary> {
  const workflow = mastra.getWorkflow('review-engine');
  const run = await workflow.createRun();
  const result = await run.start({ inputData: { reviewId } });
  return { runId: run.runId, status: result.status };
}
