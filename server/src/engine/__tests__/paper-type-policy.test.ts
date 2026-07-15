import { describe, expect, it } from 'vitest';
import {
  applyPaperTypeLensPolicy,
  LENSES,
  paperTypeNote,
  selectActiveLenses,
  studyDesignAffirmsData,
} from '../lenses';
import type { PaperType } from '../options';

const allLenses = LENSES;
const empiricalActive = selectActiveLenses('thorough', []);

function prefixes(paperType: PaperType | null, affirmsData: boolean, base = empiricalActive): string[] {
  return applyPaperTypeLensPolicy(base, paperType, affirmsData)
    .map((lens) => lens.prefix)
    .sort();
}

describe('studyDesignAffirmsData', () => {
  it('treats conceptual designs as no data and everything else as data', () => {
    expect(studyDesignAffirmsData('theory')).toBe(false);
    expect(studyDesignAffirmsData('commentary')).toBe(false);
    expect(studyDesignAffirmsData('protocol')).toBe(false);
    expect(studyDesignAffirmsData('randomized-trial')).toBe(true);
    expect(studyDesignAffirmsData('cross-sectional')).toBe(true);
    expect(studyDesignAffirmsData('psychometric')).toBe(true);
    expect(studyDesignAffirmsData('case-study')).toBe(true);
  });
});

describe('applyPaperTypeLensPolicy', () => {
  it('leaves empirical and null paper types unchanged', () => {
    expect(prefixes('empirical', false)).toEqual([...empiricalActive.map((l) => l.prefix)].sort());
    expect(prefixes(null, false)).toEqual([...empiricalActive.map((l) => l.prefix)].sort());
  });

  it('drops empirical lenses for a theoretical paper with no data', () => {
    const result = prefixes('theoretical', false);
    for (const dropped of ['METH', 'STAT', 'MEAS', 'CAUS']) {
      expect(result).not.toContain(dropped);
    }
    expect(result).toContain('ARG');
    expect(result).toContain('THEO');
  });

  it('keeps empirical lenses for a theoretical paper that the analyst says has data', () => {
    const result = prefixes('theoretical', true);
    expect(result).toContain('METH');
    expect(result).toContain('STAT');
  });

  it('drops the empirical lenses for a perspective piece with no data', () => {
    const result = prefixes('perspective-or-opinion', false);
    expect(result).not.toContain('METH');
    expect(result).not.toContain('CAUS');
  });

  it('forces ARG, NOV, THEO and keeps METH for a review even from a bare core set', () => {
    const core = selectActiveLenses('fast', []);
    const result = applyPaperTypeLensPolicy(core, 'review', false).map((lens) => lens.prefix);
    for (const forced of ['ARG', 'NOV', 'THEO', 'METH']) {
      expect(result).toContain(forced);
    }
  });

  it('forces METH, STAT, MEAS for a methodological paper even when the activation map omitted them', () => {
    const core = selectActiveLenses('fast', []);
    const result = applyPaperTypeLensPolicy(core, 'methodological', false).map((lens) => lens.prefix);
    for (const forced of ['METH', 'STAT', 'MEAS']) {
      expect(result).toContain(forced);
    }
  });

  it('drops STAT for a case study without data but keeps it with data', () => {
    expect(prefixes('case-study', false)).not.toContain('STAT');
    expect(prefixes('case-study', true)).toContain('STAT');
    expect(prefixes('case-study', false)).toContain('METH');
  });

  it('never invents a lens outside the canonical table', () => {
    const known = new Set(allLenses.map((lens) => lens.prefix));
    for (const paperType of ['theoretical', 'review', 'methodological', 'case-study', 'perspective-or-opinion'] as PaperType[]) {
      for (const prefix of prefixes(paperType, false)) {
        expect(known.has(prefix)).toBe(true);
      }
    }
  });
});

describe('paperTypeNote', () => {
  it('returns null for empirical and null, and a sentence otherwise', () => {
    expect(paperTypeNote('empirical')).toBeNull();
    expect(paperTypeNote(null)).toBeNull();
    expect(paperTypeNote('perspective-or-opinion')).toContain('perspective');
    expect(paperTypeNote('review')).toContain('review');
    expect(paperTypeNote('methodological')).toContain('method');
  });
});
