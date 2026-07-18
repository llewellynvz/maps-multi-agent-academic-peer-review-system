import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { NoObjectGeneratedError } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';
import { blobDir } from '../../paths';
import type { DispatchResult } from '../../providers';
import { runAgent } from '../dispatch-agent';

const reviewIds: string[] = [];

function freshReviewId(): string {
  const id = `test-dispatch-agent-${randomUUID()}`;
  reviewIds.push(id);
  return id;
}

afterEach(() => {
  for (const id of reviewIds.splice(0)) {
    rmSync(blobDir(id), { recursive: true, force: true });
  }
});

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'REV-METH-0001',
    lens: 'Methods and design',
    phase: 3,
    claim: 'The design cannot support causal claims.',
    anchor: 'Analysis (lines 38-39)',
    epistemic: 'Known',
    confidence: 0.95,
    band: 'Yellow',
    severity: 'major',
    fixability: 'moderate',
    scope: 'author-facing',
    failureScenario: 'Readers over-interpret the mediation model.',
    leanestFix: 'Reframe as associations.',
    supersedes: null,
    ...overrides,
  };
}

function specialistPayload(findings: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    lens: 'Methods and design',
    coreContributionReading: 'A cross-sectional survey of stress and wellbeing.',
    findings,
    challengeRound: null,
    selfCritique: { strongestObjection: 'Mock output; not derived from evidence.', confidenceRaisers: ['A real dispatch'] },
  };
}

function successResult(object: unknown): DispatchResult {
  return {
    dispatchId: 'd1',
    provider: 'azure',
    model: 'test',
    status: 'success',
    object,
    tokens: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, reasoningTokens: 0 },
    latencyMs: 1,
    langfuseTraceId: null,
    replayed: false,
  };
}

function noObjectError(payload: unknown): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: 'No object generated: response did not match schema.',
    text: JSON.stringify(payload),
    cause: new Error('response did not match schema'),
    response: { id: 'r1', timestamp: new Date(), modelId: 'test' },
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    },
    finishReason: 'stop',
  });
}

describe('runAgent schema salvage', () => {
  it('repairs band-confidence mismatches from a rejected response without a retry', async () => {
    const bad = specialistPayload([finding({ band: 'Green', confidence: 0.95 }), finding({ id: 'REV-METH-0002', band: 'Green', confidence: 0.9 })]);
    let dispatches = 0;
    const result = await runAgent<{ findings: Array<{ band: string }> }>(
      {
        runDispatch: async () => {
          dispatches += 1;
          throw noObjectError(bad);
        },
      },
      {
        reviewId: freshReviewId(),
        phase: 'phase_3',
        agent: 'specialist-reviewer',
        artefactName: 'p3-METH-first',
        assembleInput: { lens: 'Methods and design' },
      },
    );

    expect(dispatches).toBe(1);
    expect(result.findings.map((f) => f.band)).toEqual(['Yellow', 'Yellow']);
  });

  it('feeds exact schema defects into the retry prompt when salvage cannot repair', async () => {
    const bad = specialistPayload([finding({ id: 'not-a-finding-id' })]);
    const good = specialistPayload([finding()]);
    const prompts: string[] = [];
    const result = await runAgent<{ findings: unknown[] }>(
      {
        runDispatch: async (input) => {
          prompts.push(String(input.parts.prompt));
          if (prompts.length === 1) {
            throw noObjectError(bad);
          }
          return successResult(good);
        },
      },
      {
        reviewId: freshReviewId(),
        phase: 'phase_3',
        agent: 'specialist-reviewer',
        artefactName: 'p3-METH-first',
        assembleInput: { lens: 'Methods and design' },
      },
    );

    expect(result.findings).toHaveLength(1);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('findings.0.id');
  });

  it('does not retry a context-length error and fails fast', async () => {
    let dispatches = 0;
    await expect(
      runAgent(
        {
          runDispatch: async () => {
            dispatches += 1;
            throw new Error("This model's maximum context length is 128000 tokens (context_length_exceeded)");
          },
        },
        {
          reviewId: freshReviewId(),
          phase: 'phase_3',
          agent: 'specialist-reviewer',
          artefactName: 'p3-METH-first',
          assembleInput: { lens: 'Methods and design' },
        },
      ),
    ).rejects.toThrow('exceeds the model context window');
    expect(dispatches).toBe(1);
  });

  it('still fails after exhausting attempts on unrepairable output', async () => {
    const bad = specialistPayload([finding({ id: 'nope' })]);
    let dispatches = 0;
    await expect(
      runAgent(
        {
          runDispatch: async () => {
            dispatches += 1;
            throw noObjectError(bad);
          },
        },
        {
          reviewId: freshReviewId(),
          phase: 'phase_3',
          agent: 'specialist-reviewer',
          artefactName: 'p3-METH-first',
          assembleInput: { lens: 'Methods and design' },
        },
      ),
    ).rejects.toThrow('failed after 3 attempts');
    expect(dispatches).toBe(3);
  });
});
