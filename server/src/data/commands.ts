import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { MaraDatabase } from '../db/client';
import { phaseCheckpoints, reviews, runCommands } from '../db/schema';
import { nowIso } from './db';
import { ApiError } from './errors';
import { requireReview } from './reviews';

export type RunCommand = 'run' | 'pause' | 'resume' | 'cancel' | 'retry_phase';

export function insertRunCommand(
  db: MaraDatabase,
  reviewId: string,
  command: RunCommand,
  args: Record<string, unknown> = {},
): string {
  const id = randomUUID();
  db.insert(runCommands)
    .values({ id, reviewId, command, argsJson: JSON.stringify(args), createdAt: nowIso() })
    .run();
  return id;
}

const ACTIVE_STATUSES = new Set(['running', 'sanitizing']);

function otherActiveExists(db: MaraDatabase, reviewId: string): boolean {
  const rows = db.select({ id: reviews.id, status: reviews.status }).from(reviews).all();
  return rows.some((row) => row.id !== reviewId && ACTIVE_STATUSES.has(row.status));
}

export interface RunControlResult {
  accepted: true;
  command: RunCommand;
  noop?: boolean;
  queued?: boolean;
  status: string;
}

export function submitRunControl(
  db: MaraDatabase,
  reviewId: string,
  command: RunCommand,
  args: Record<string, unknown> = {},
): RunControlResult {
  const review = requireReview(db, reviewId);

  if (command === 'retry_phase') {
    validateRetryPhase(db, reviewId, args);
  }

  let noop = false;
  let queued = false;

  if (command === 'run') {
    if (ACTIVE_STATUSES.has(review.status)) {
      noop = true;
    } else if (otherActiveExists(db, reviewId)) {
      queued = true;
    }
  } else if (command === 'pause') {
    if (!ACTIVE_STATUSES.has(review.status)) {
      noop = true;
    }
  } else if (command === 'resume') {
    if (review.status !== 'paused' && review.status !== 'awaiting_input') {
      noop = true;
    }
  } else if (command === 'cancel') {
    if (['completed', 'failed', 'cancelled'].includes(review.status)) {
      noop = true;
    }
  }

  if (!noop) {
    insertRunCommand(db, reviewId, command, args);
  }

  return {
    accepted: true,
    command,
    ...(noop ? { noop: true } : {}),
    ...(queued ? { queued: true } : {}),
    status: review.status,
  };
}

function validateRetryPhase(db: MaraDatabase, reviewId: string, args: Record<string, unknown>): void {
  const phase = typeof args.phase === 'string' ? args.phase : '';
  if (phase === '') {
    throw new ApiError('unprocessable', 'A phase name is required to retry a phase.', { field: 'phase' });
  }
  const candidates = [phase, `engine_${phase}`];
  const rows = db.select().from(phaseCheckpoints).where(eq(phaseCheckpoints.reviewId, reviewId)).all();
  const match = rows.find((row) => candidates.includes(row.phase));
  if (match === undefined) {
    throw new ApiError('unprocessable', `No checkpoint exists for phase ${phase}.`, { field: 'phase' });
  }
  if (match.status !== 'failed' && match.status !== 'completed') {
    throw new ApiError('unprocessable', `Phase ${phase} is ${match.status} and cannot be retried.`, { field: 'phase' });
  }
}
