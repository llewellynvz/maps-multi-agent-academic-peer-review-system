import { describe, expect, it } from 'vitest';
import {
  confidenceBandPhrase,
  formatBytes,
  hasFindingIds,
  PHASE_DESCRIPTIONS,
  PHASES,
  RECOMMENDATION_EXPLANATION,
  RECOMMENDATION_LABEL,
} from '@/lib/format';

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

describe('hasFindingIds', () => {
  it('detects legacy inline finding tokens and ignores id-free prose', () => {
    expect(hasFindingIds('The design is underpowered (REV-STAT-0007).')).toBe(true);
    expect(hasFindingIds('See REV-METH-0012 and REV-NOV-0003.')).toBe(true);
    expect(hasFindingIds('The design is underpowered for the stated effect.')).toBe(false);
    expect(hasFindingIds('REV-XX-1 is not a valid finding id.')).toBe(false);
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
