export interface RetrySignal {
  attempt: number | null;
  maxAttempts: number | null;
  reason: string | null;
}

function numberField(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function stringField(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

export function parseRetrySignal(data: unknown): RetrySignal | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  if (record.retry !== true) {
    return null;
  }
  return {
    attempt: numberField(record, ['attempt', 'attemptNumber']),
    maxAttempts: numberField(record, ['maxAttempts', 'attemptBudget']),
    reason: stringField(record, ['reason', 'message']),
  };
}

export function retryPillLabel(signal: RetrySignal): string {
  const lead = signal.reason !== null && signal.reason.includes('release gate') ? 'Release gate blocked' : 'Run interrupted';
  if (signal.attempt !== null && signal.maxAttempts !== null) {
    return `${lead}, retrying (attempt ${signal.attempt} of ${signal.maxAttempts})`;
  }
  return `${lead}, retrying`;
}

export function retryLogMessage(signal: RetrySignal): string {
  const label = retryPillLabel(signal);
  return signal.reason !== null ? `${label}. Reason: ${signal.reason}` : label;
}

// The release gate reports its cycle zero-based and spells its verdicts as the critic and arbitration do:
// revise, revise-specialist, block, arbitrated, and the post-arbitration aligned or aligned-fallback. A
// pass or a completed alignment needs no pill.
export function gatePillLabel(verdict: string, cycle: number): string | null {
  const key = verdict.trim().toLowerCase().replace(/_/g, '-');
  const shown = cycle + 1;
  if (key === 'pass' || key === 'aligned' || key === 'aligned-fallback') {
    return null;
  }
  if (key === 'revise' || key === 'revise-specialist') {
    return `Release gate requested revisions, cycle ${shown} of 2`;
  }
  if (key === 'block') {
    return `Release gate blocked the draft, cycle ${shown} of 2`;
  }
  return 'Release gate escalated to arbitration';
}
