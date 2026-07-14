import { DispatchPauseError } from '../engine/phases-shared';
import type { DispatchRunner } from '../providers';

export class StaleDispatchError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`stale dispatch: ${reason}`);
    this.name = 'StaleDispatchError';
    this.reason = reason;
  }
}

export interface SuperviseOptions {
  timeoutMs: number;
  clock?: () => number;
  jumpPollMs?: number;
  onStale?: (reason: string) => void;
}

export function superviseDispatch(inner: DispatchRunner, options: SuperviseOptions): DispatchRunner {
  const clock = options.clock ?? Date.now;
  const jumpPollMs = Math.max(1, options.jumpPollMs ?? 250);
  return async (input) => {
    let lastClock = clock();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poller: ReturnType<typeof setInterval> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new StaleDispatchError('timeout')), Math.max(1, options.timeoutMs));
    });
    const jump = new Promise<never>((_, reject) => {
      poller = setInterval(() => {
        const current = clock();
        if (current < lastClock) {
          reject(new StaleDispatchError('clock_jump'));
        }
        lastClock = current;
      }, jumpPollMs);
    });
    try {
      return await Promise.race([inner(input), timeout, jump]);
    } catch (error) {
      if (error instanceof StaleDispatchError) {
        options.onStale?.(error.reason);
      }
      throw error;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (poller !== undefined) {
        clearInterval(poller);
      }
    }
  };
}

export type StopSignal = 'pause' | 'cancel' | 'shutdown' | null;

export interface EnginePhaseStep<D> {
  name: string;
  run: (deps: D, reviewId: string) => Promise<void>;
}

export interface RunEnginePhasesParams<D> {
  deps: D;
  reviewId: string;
  phases: Array<EnginePhaseStep<D>>;
  shouldStop: () => StopSignal;
  maxRestartsPerPhase?: number;
  onStale?: (info: { phase: string; restart: number; reason: string }) => void;
  onPause?: (info: { phase: string; reason: string; detail?: Record<string, unknown> }) => void;
  afterPhase?: (name: string) => void;
}

export type EngineOutcome = 'completed' | 'paused' | 'cancelled' | 'stopped';

export async function runEnginePhases<D>(params: RunEnginePhasesParams<D>): Promise<EngineOutcome> {
  const max = params.maxRestartsPerPhase ?? 3;
  for (const phase of params.phases) {
    const signal = params.shouldStop();
    if (signal === 'cancel') {
      return 'cancelled';
    }
    if (signal === 'pause') {
      return 'paused';
    }
    if (signal === 'shutdown') {
      return 'stopped';
    }

    let restarts = 0;
    for (;;) {
      try {
        await phase.run(params.deps, params.reviewId);
        break;
      } catch (error) {
        if (error instanceof DispatchPauseError) {
          params.onPause?.({ phase: phase.name, reason: error.reason, ...(error.detail !== undefined ? { detail: error.detail } : {}) });
          return 'paused';
        }
        if (error instanceof StaleDispatchError && restarts < max) {
          const interrupt = params.shouldStop();
          if (interrupt === 'cancel') {
            return 'cancelled';
          }
          if (interrupt === 'pause') {
            return 'paused';
          }
          if (interrupt === 'shutdown') {
            return 'stopped';
          }
          restarts += 1;
          params.onStale?.({ phase: phase.name, restart: restarts, reason: error.reason });
          continue;
        }
        throw error;
      }
    }
    params.afterPhase?.(phase.name);
  }
  return 'completed';
}
