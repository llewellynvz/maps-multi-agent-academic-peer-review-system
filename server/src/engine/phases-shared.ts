import type { CitationClient } from '../citations';
import type { MaraDatabase } from '../db/client';
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

export interface EngineDeps {
  db: MaraDatabase;
  runDispatch: DispatchRunner;
  citationClient?: CitationClient;
  egress?: EgressController;
  preDispatch?: PreDispatchGate;
}
