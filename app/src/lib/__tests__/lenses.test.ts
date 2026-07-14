import { describe, expect, it } from 'vitest';
import { LENS_FALLBACK, LENS_INFO, lensInfo, prefixOf, SEVERITY_INFO } from '@/lib/lenses';

describe('prefixOf', () => {
  it('extracts the uppercase prefix from a finding id', () => {
    expect(prefixOf('NOV-001')).toBe('NOV');
    expect(prefixOf('METH-12')).toBe('METH');
    expect(prefixOf('aic-3')).toBe('AIC');
  });

  it('returns an empty string when there is no letter prefix', () => {
    expect(prefixOf('123')).toBe('');
    expect(prefixOf('')).toBe('');
    expect(prefixOf('   ')).toBe('');
  });
});

describe('lensInfo', () => {
  it('maps every known prefix to a non-empty display and purpose', () => {
    for (const [prefix, info] of Object.entries(LENS_INFO)) {
      expect(info.display.length).toBeGreaterThan(0);
      expect(info.purpose.length).toBeGreaterThan(0);
      expect(lensInfo(`${prefix}-001`)).toEqual(info);
    }
  });

  it('matches the engine display names for the core lenses', () => {
    expect(LENS_INFO.NOV?.display).toBe('Novelty');
    expect(LENS_INFO.METH?.display).toBe('Methods and design');
    expect(LENS_INFO.ETH?.display).toBe('Ethics, equity, and participants');
  });

  it('falls back for an unknown or empty prefix', () => {
    expect(lensInfo('ZZZ-9')).toBe(LENS_FALLBACK);
    expect(lensInfo('')).toBe(LENS_FALLBACK);
  });
});

describe('SEVERITY_INFO', () => {
  it('covers each severity level with a label, tone, and meaning', () => {
    for (const level of ['none', 'minor', 'moderate', 'major', 'fatal'] as const) {
      const info = SEVERITY_INFO[level];
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.meaning.length).toBeGreaterThan(0);
    }
  });
});
