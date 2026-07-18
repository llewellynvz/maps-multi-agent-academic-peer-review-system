import { describe, expect, it } from 'vitest';
import {
  applyPaperTypeLensPolicy,
  LENSES,
  paperTypeNote,
  qualitativeRigourNote,
  selectActiveLenses,
  studyDesignAffirmsData,
  studyDesignIsMixed,
  studyDesignIsQualitative,
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

  it('catches conceptual design labels beyond the original three exact tokens', () => {
    for (const design of ['conceptual', 'theoretical', 'perspective', 'position paper', 'essay', 'opinion', 'viewpoint', 'editorial']) {
      expect(studyDesignAffirmsData(design)).toBe(false);
    }
  });

  it('does not strip empirical lenses from an empirical design that merely mentions theory', () => {
    expect(studyDesignAffirmsData('theory-driven survey')).toBe(true);
    expect(studyDesignAffirmsData('longitudinal cohort')).toBe(true);
  });

  it('treats an empirical design as data even when a non-data word appears alongside a data marker', () => {
    expect(studyDesignAffirmsData('opinion survey')).toBe(true);
    expect(studyDesignAffirmsData('position questionnaire')).toBe(true);
  });
});

describe('qualitative handling', () => {
  it('detects qualitative designs and not quantitative ones', () => {
    expect(studyDesignIsQualitative('qualitative interview study')).toBe(true);
    expect(studyDesignIsQualitative('grounded theory')).toBe(true);
    expect(studyDesignIsQualitative('interpretative phenomenological analysis')).toBe(true);
    expect(studyDesignIsQualitative('randomized-trial')).toBe(false);
    expect(studyDesignIsQualitative('cross-sectional survey')).toBe(false);
  });

  it('does not misclassify quantitative or mixed designs that mention a qualitative term', () => {
    expect(studyDesignIsQualitative('quantitative content analysis')).toBe(false);
    expect(studyDesignIsQualitative('mixed methods with thematic analysis and SEM')).toBe(false);
  });

  it('keeps the statistical lenses and adds MIX and QUAL for a mixed-methods design', () => {
    const result = applyPaperTypeLensPolicy(empiricalActive, 'empirical', true, 'mixed methods with thematic analysis and regression')
      .map((lens) => lens.prefix);
    expect(result).toContain('MIX');
    expect(result).toContain('QUAL');
    expect(result).toContain('STAT');
  });

  it('swaps the quantitative lenses for QUAL on a qualitative design, regardless of paper type', () => {
    const result = applyPaperTypeLensPolicy(empiricalActive, 'empirical', true, 'qualitative interviews')
      .map((lens) => lens.prefix);
    expect(result).toContain('QUAL');
    for (const dropped of ['STAT', 'MEAS', 'CAUS']) {
      expect(result).not.toContain(dropped);
    }
    expect(result).toContain('METH');
  });

  it('emits a qualitative-rigour note for qualitative designs only', () => {
    expect(qualitativeRigourNote('grounded theory')).toContain('trustworthiness');
    expect(qualitativeRigourNote('randomized-trial')).toBeNull();
  });

  it('keeps the statistical lenses for a qualitative design that also carries quantitative data', () => {
    for (const design of ['surveys and interviews', 'content analysis of survey responses', 'questionnaire and focus groups']) {
      const result = applyPaperTypeLensPolicy(empiricalActive, 'empirical', true, design).map((lens) => lens.prefix);
      expect(result).toContain('STAT');
      expect(result).toContain('QUAL');
      expect(result).toContain('MIX');
    }
  });

  it('still strips the statistical lenses for a purely qualitative design with no quantitative data', () => {
    const result = applyPaperTypeLensPolicy(empiricalActive, 'empirical', true, 'qualitative interviews').map((lens) => lens.prefix);
    expect(result).not.toContain('STAT');
    expect(result).toContain('QUAL');
  });

  it('detects mixed and qualitative designs written with underscores or hyphens', () => {
    expect(studyDesignIsMixed('mixed_methods')).toBe(true);
    expect(studyDesignIsMixed('mixed-methods')).toBe(true);
    expect(studyDesignIsQualitative('grounded_theory')).toBe(true);
  });
});

describe('applyPaperTypeLensPolicy', () => {
  it('leaves empirical and null paper types unchanged', () => {
    expect(prefixes('empirical', false)).toEqual([...empiricalActive.map((l) => l.prefix)].sort());
    expect(prefixes(null, false)).toEqual([...empiricalActive.map((l) => l.prefix)].sort());
  });

  it('drops empirical and qualitative lenses for a theoretical paper with no data', () => {
    const result = prefixes('theoretical', false);
    for (const dropped of ['METH', 'STAT', 'MEAS', 'CAUS', 'QUAL']) {
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

  it('drops the empirical and qualitative lenses for a perspective piece with no data', () => {
    const result = prefixes('perspective-or-opinion', false);
    expect(result).not.toContain('METH');
    expect(result).not.toContain('CAUS');
    expect(result).not.toContain('QUAL');
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
