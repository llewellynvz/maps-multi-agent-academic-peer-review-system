import { describe, expect, it } from 'vitest';
import { gatePillLabel, parseRetrySignal, retryLogMessage, retryPillLabel } from '@/lib/runEvents';

describe('parseRetrySignal', () => {
  it('parses a full retry announcement', () => {
    const signal = parseRetrySignal({
      retry: true,
      attempt: 2,
      maxAttempts: 3,
      reason: 'the release gate blocked the deliverables',
      phase: 'phase_7',
    });
    expect(signal).toEqual({ attempt: 2, maxAttempts: 3, reason: 'the release gate blocked the deliverables' });
    expect(retryPillLabel(signal!)).toBe('Release gate blocked, retrying (attempt 2 of 3)');
    expect(retryLogMessage(signal!)).toContain('the release gate blocked the deliverables');
  });

  it('labels an engine-error retry as interrupted, not gate-blocked', () => {
    const signal = parseRetrySignal({ retry: true, attempt: 1, maxAttempts: 2, reason: 'a transient engine error interrupted phase_3' });
    expect(retryPillLabel(signal!)).toBe('Run interrupted, retrying (attempt 1 of 2)');
  });

  it('tolerates missing or renamed fields without losing the signal', () => {
    expect(parseRetrySignal({ retry: true })).toEqual({ attempt: null, maxAttempts: null, reason: null });
    const renamed = parseRetrySignal({ retry: true, attemptNumber: 1, attemptBudget: 2, message: 'renamed' });
    expect(renamed).toEqual({ attempt: 1, maxAttempts: 2, reason: 'renamed' });
    expect(retryPillLabel({ attempt: null, maxAttempts: null, reason: null })).toBe('Run interrupted, retrying');
  });

  it('returns null for ordinary phase events and junk', () => {
    expect(parseRetrySignal({ phase: 'phase_5' })).toBeNull();
    expect(parseRetrySignal({ retry: false, attempt: 1 })).toBeNull();
    expect(parseRetrySignal(null)).toBeNull();
    expect(parseRetrySignal('retry')).toBeNull();
  });
});

describe('gatePillLabel', () => {
  it('shows cycles one-based and names each verdict the gate actually sends', () => {
    expect(gatePillLabel('revise', 0)).toBe('Release gate requested revisions, cycle 1 of 2');
    expect(gatePillLabel('revise-specialist', 1)).toBe('Release gate requested revisions, cycle 2 of 2');
    expect(gatePillLabel('revise_specialist', 0)).toContain('requested revisions');
    expect(gatePillLabel('block', 0)).toContain('blocked');
    expect(gatePillLabel('arbitrated', 2)).toBe('Release gate escalated to arbitration');
  });

  it('clears the pill on a pass or a completed alignment', () => {
    expect(gatePillLabel('pass', 0)).toBeNull();
    expect(gatePillLabel('aligned', 2)).toBeNull();
    expect(gatePillLabel('aligned-fallback', 2)).toBeNull();
  });
});
