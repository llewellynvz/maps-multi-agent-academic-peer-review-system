import { describe, expect, it } from 'vitest';
import { matchLens, normalisePreset, selectActiveLenses, selectChallengeLenses, swarmProfile } from '../lenses';

describe('lens routing', () => {
  it('fast preset activates exactly the six core lenses', () => {
    const active = selectActiveLenses('fast', []);
    expect(active).toHaveLength(6);
    expect(active.every((lens) => lens.core)).toBe(true);
    expect(new Set(active.map((lens) => lens.prefix))).toEqual(new Set(['NOV', 'ARG', 'THEO', 'METH', 'PRAC', 'ETH']));
  });

  it('thorough preset activates all eleven lenses', () => {
    expect(selectActiveLenses('thorough', [])).toHaveLength(11);
  });

  it('balanced preset adds active activation-map lenses to the core set', () => {
    const active = selectActiveLenses('balanced', [
      { lens: 'Statistical (REV-STAT)', active: true },
      { lens: 'Measurement', active: false },
    ]);
    const prefixes = new Set(active.map((lens) => lens.prefix));
    expect(prefixes.has('STAT')).toBe(true);
    expect(prefixes.has('MEAS')).toBe(false);
    expect(prefixes.size).toBe(7);
  });

  it('fast preset challenge round picks the three highest-severity lenses', () => {
    const active = selectActiveLenses('fast', []);
    const severities = new Map<string, string[]>([
      ['NOV', ['minor']],
      ['ARG', ['none']],
      ['THEO', ['moderate']],
      ['METH', ['fatal']],
      ['PRAC', ['major']],
      ['ETH', ['minor']],
    ]);
    const challenge = selectChallengeLenses('fast', active, severities);
    expect(challenge.map((lens) => lens.prefix)).toEqual(['METH', 'PRAC', 'THEO']);
  });

  it('balanced preset challenge round keeps every active lens', () => {
    const active = selectActiveLenses('thorough', []);
    expect(selectChallengeLenses('balanced', active, new Map())).toHaveLength(active.length);
  });

  it('matchLens resolves prefix and display forms and rejects noise', () => {
    expect(matchLens('Statistical (REV-STAT)')?.prefix).toBe('STAT');
    expect(matchLens('methods and design')?.prefix).toBe('METH');
    expect(matchLens('completely unrelated text')).toBeUndefined();
  });

  it('normalisePreset defaults unknown values to balanced', () => {
    expect(normalisePreset('fast')).toBe('fast');
    expect(normalisePreset(undefined)).toBe('balanced');
    expect(normalisePreset('weird')).toBe('balanced');
  });

  it('swarm profile follows the preset population', () => {
    expect(swarmProfile('fast').populationSize).toBe(12);
    expect(swarmProfile('balanced').populationSize).toBe(24);
    expect(swarmProfile('thorough').populationSize).toBe(48);
  });
});
