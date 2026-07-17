import { describe, expect, it } from 'vitest';
import {
  confidenceBandPhrase,
  formatBytes,
  formatRelative,
  PHASE_DESCRIPTIONS,
  PHASES,
  RECOMMENDATION_EXPLANATION,
  RECOMMENDATION_LABEL,
  statusTone,
} from '@/lib/format';

describe('statusTone', () => {
  it('gives a finished review a different tone from an in-flight one', () => {
    expect(statusTone('completed').tone).toBe('success');
    expect(statusTone('running').tone).toBe('info');
    expect(statusTone('completed').tone).not.toBe(statusTone('running').tone);
  });

  it('keeps failure visually distinct from every other state', () => {
    const fail = statusTone('failed').tone;
    for (const status of ['completed', 'running', 'queued', 'paused'] as const) {
      expect(statusTone(status).tone).not.toBe(fail);
    }
  });
});

describe('formatRelative', () => {
  it('describes recent timestamps in words rather than a bare date', () => {
    const now = Date.parse('2026-07-16T12:00:00.000Z');
    expect(formatRelative('2026-07-16T11:59:30.000Z', now)).toContain('second');
    expect(formatRelative('2026-07-16T11:30:00.000Z', now)).toContain('minute');
    expect(formatRelative('2026-07-16T09:00:00.000Z', now)).toContain('hour');
    expect(formatRelative('2026-07-14T12:00:00.000Z', now)).toContain('day');
  });

  it('falls back to an absolute date beyond a week', () => {
    const now = Date.parse('2026-07-16T12:00:00.000Z');
    expect(formatRelative('2026-06-01T12:00:00.000Z', now)).toBe('2026-06-01');
  });
});

describe('PHASE_DESCRIPTIONS', () => {
  it('covers every phase key with a plain-language sentence', () => {
    for (const phase of PHASES) {
      const description = PHASE_DESCRIPTIONS[phase.key];
      expect(description, phase.key).toBeDefined();
      expect((description ?? '').length).toBeGreaterThan(0);
    }
  });
});

describe('RECOMMENDATION_EXPLANATION', () => {
  it('explains every recommendation label', () => {
    for (const key of Object.keys(RECOMMENDATION_LABEL)) {
      const explanation = RECOMMENDATION_EXPLANATION[key];
      expect(explanation, key).toBeDefined();
      expect((explanation ?? '').length).toBeGreaterThan(0);
    }
  });
});

describe('confidenceBandPhrase', () => {
  it('maps confidence to a qualitative band at each boundary', () => {
    expect(confidenceBandPhrase(1)).toBe('high confidence');
    expect(confidenceBandPhrase(0.9)).toBe('high confidence');
    expect(confidenceBandPhrase(0.89)).toBe('reasonable confidence');
    expect(confidenceBandPhrase(0.7)).toBe('reasonable confidence');
    expect(confidenceBandPhrase(0.69)).toBe('with reservations');
    expect(confidenceBandPhrase(0)).toBe('with reservations');
    expect(confidenceBandPhrase(null)).toBe('not yet rated');
  });
});

describe('formatBytes', () => {
  it('renders human-readable sizes', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
