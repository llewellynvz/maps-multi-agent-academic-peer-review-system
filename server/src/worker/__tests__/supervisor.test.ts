import { describe, expect, it } from 'vitest';
import type { DispatchResult } from '../../providers';
import { StaleDispatchError, runEnginePhases, superviseDispatch, type StopSignal } from '../supervisor';

function fakeResult(): DispatchResult {
  return {
    dispatchId: 'd1',
    provider: 'openai',
    model: 'test',
    status: 'success',
    tokens: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, reasoningTokens: 0 },
    latencyMs: 1,
    langfuseTraceId: null,
    replayed: false,
  };
}

const input = {
  reviewId: 'r1',
  phase: 'phase_1',
  agent: 'a',
  promptVersion: 'v1',
  parts: {},
};

describe('superviseDispatch', () => {
  it('passes through a healthy dispatch', async () => {
    const wrapped = superviseDispatch(async () => fakeResult(), { timeoutMs: 1000 });
    const result = await wrapped(input);
    expect(result.status).toBe('success');
  });

  it('raises StaleDispatchError when a dispatch exceeds its timeout', async () => {
    const wrapped = superviseDispatch(() => new Promise<DispatchResult>(() => undefined), { timeoutMs: 15 });
    await expect(wrapped(input)).rejects.toBeInstanceOf(StaleDispatchError);
    await expect(wrapped(input)).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('raises StaleDispatchError on a backwards clock jump while a dispatch is in flight', async () => {
    let clockValue = 100_000;
    const wrapped = superviseDispatch(
      () => new Promise<DispatchResult>((resolve) => setTimeout(() => resolve(fakeResult()), 400)),
      { timeoutMs: 5000, clock: () => clockValue, jumpPollMs: 10 },
    );
    const pending = wrapped(input);
    setTimeout(() => {
      clockValue -= 60_000;
    }, 30);
    await expect(pending).rejects.toMatchObject({ reason: 'clock_jump' });
  });

  it('does not raise on a fast successful dispatch', async () => {
    let clockValue = 100_000;
    const wrapped = superviseDispatch(async () => fakeResult(), {
      timeoutMs: 5000,
      clock: () => clockValue,
      jumpPollMs: 10,
    });
    const result = await wrapped(input);
    clockValue -= 60_000;
    expect(result.status).toBe('success');
  });
});

describe('runEnginePhases', () => {
  it('cancels a stale dispatch and re-issues the phase from its checkpoint', async () => {
    const dispatchCalls: number[] = [];
    let firstAttempt = true;
    const wrapped = superviseDispatch(
      async () => {
        dispatchCalls.push(dispatchCalls.length);
        if (firstAttempt) {
          firstAttempt = false;
          throw new StaleDispatchError('timeout');
        }
        return fakeResult();
      },
      { timeoutMs: 5000 },
    );

    const phaseRuns: string[] = [];
    const staleEvents: string[] = [];
    const completedSubSteps = new Set<string>();
    const outcome = await runEnginePhases({
      deps: { wrapped },
      reviewId: 'r1',
      phases: [
        {
          name: 'phase_1',
          run: async (deps: { wrapped: typeof wrapped }) => {
            phaseRuns.push('phase_1');
            await deps.wrapped(input);
            completedSubSteps.add('phase_1');
          },
        },
      ],
      shouldStop: () => null,
      onStale: (info) => staleEvents.push(`${info.phase}:${info.reason}`),
    });

    expect(outcome).toBe('completed');
    expect(phaseRuns).toEqual(['phase_1', 'phase_1']);
    expect(dispatchCalls.length).toBe(2);
    expect(staleEvents).toEqual(['phase_1:timeout']);
    expect(completedSubSteps.has('phase_1')).toBe(true);
  });

  it('halts at a pause boundary before the next phase', async () => {
    const runOrder: string[] = [];
    let stop: StopSignal = null;
    const outcome = await runEnginePhases({
      deps: {},
      reviewId: 'r1',
      phases: [
        { name: 'phase_1', run: async () => { runOrder.push('phase_1'); stop = 'pause'; } },
        { name: 'phase_2', run: async () => { runOrder.push('phase_2'); } },
      ],
      shouldStop: () => stop,
    });
    expect(outcome).toBe('paused');
    expect(runOrder).toEqual(['phase_1']);
  });

  it('propagates a genuine error after exhausting restarts', async () => {
    await expect(
      runEnginePhases({
        deps: {},
        reviewId: 'r1',
        phases: [{ name: 'phase_1', run: async () => { throw new Error('boom'); } }],
        shouldStop: () => null,
      }),
    ).rejects.toThrow('boom');
  });

  it('stops instead of restarting a stale phase once shutdown is signalled', async () => {
    const runOrder: string[] = [];
    let stop: StopSignal = null;
    const outcome = await runEnginePhases({
      deps: {},
      reviewId: 'r1',
      phases: [
        {
          name: 'phase_1',
          run: async () => {
            runOrder.push('phase_1');
            stop = 'shutdown';
            throw new StaleDispatchError('timeout');
          },
        },
      ],
      shouldStop: () => stop,
    });
    expect(outcome).toBe('stopped');
    expect(runOrder).toEqual(['phase_1']);
  });
});
