import type { CitationClient } from '../citations';
import type { MaraDatabase } from '../db/client';
import { insertEvent, updateReview } from '../workflow/repo';
import type { DispatchRunner } from '../providers';
import type { EgressController } from '../security';

export interface PreDispatchInfo {
  reviewId: string;
  phase: string;
  agent: string;
  mode?: string;
}

export interface PreDispatchDecision {
  pause: boolean;
  reason?: string;
  detail?: Record<string, unknown>;
}

export type PreDispatchGate = (info: PreDispatchInfo) => PreDispatchDecision;

export class DispatchPauseError extends Error {
  readonly reason: string;
  readonly detail: Record<string, unknown> | undefined;

  constructor(reason: string, detail?: Record<string, unknown>) {
    super(`dispatch paused: ${reason}`);
    this.name = 'DispatchPauseError';
    this.reason = reason;
    this.detail = detail;
  }
}

export class StaleDispatchError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`stale dispatch: ${reason}`);
    this.name = 'StaleDispatchError';
    this.reason = reason;
  }
}

export interface EngineDeps {
  db: MaraDatabase;
  runDispatch: DispatchRunner;
  citationClient?: CitationClient;
  egress?: EgressController;
  preDispatch?: PreDispatchGate;
  // Set by the supervisor on a phase's last permitted attempt: a unit that times out again is recorded as
  // a coverage gap rather than failing the whole review.
  staleAsGap?: boolean;
}

// Marks a phase as running and tells the live view it has started. The phase_transition events the phases
// write when they finish carry their results, so without this the run page showed each phase only once it
// was already over, a full phase behind the work.
export function enterPhase(db: MaraDatabase, reviewId: string, phase: string): void {
  updateReview(db, reviewId, { status: 'running', currentPhase: phase });
  insertEvent(db, { reviewId, kind: 'phase_transition', phase, payload: { started: true } });
}
