import { findingSchema, type SectionMap } from '@mara/shared';
import { describe, expect, it } from 'vitest';
import {
  checkNhstTest,
  chi2UpperP,
  deterministicStatsFindings,
  extractGrimCandidates,
  extractNhstTests,
  fUpperP,
  grimCheck,
  tTwoSidedP,
  zTwoSidedP,
} from '../stats-check';

describe('distribution recomputation', () => {
  it('matches published critical values at the .05 boundary', () => {
    expect(tTwoSidedP(2.228, 10)).toBeCloseTo(0.05, 3);
    expect(fUpperP(4.965, 1, 10)).toBeCloseTo(0.05, 3);
    expect(chi2UpperP(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(zTwoSidedP(1.95996)).toBeCloseTo(0.05, 4);
  });
});

describe('extractNhstTests', () => {
  it('parses the five APA test forms', () => {
    const text =
      'We found t(28) = 2.20, p = .036 and F(2, 60) = 3.15, p = .049. ' +
      'The correlation r(30) = .35, p = .048 held, χ2(1, N = 320) = 4.68, p < .05, and Z = 1.96, p = .05.';
    const tests = extractNhstTests(text);
    const kinds = tests.map((test) => test.kind).sort();
    expect(kinds).toEqual(['F', 'chi2', 'r', 't', 'z']);
    const t = tests.find((test) => test.kind === 't');
    expect(t?.df1).toBe(28);
    expect(t?.statistic).toBeCloseTo(2.2, 10);
    expect(t?.pReported).toBeCloseTo(0.036, 10);
    const chi = tests.find((test) => test.kind === 'chi2');
    expect(chi?.pComparator).toBe('<');
  });

  it('handles unicode minus and negative statistics', () => {
    const tests = extractNhstTests('t(45) = −2.11, p = .04');
    expect(tests).toHaveLength(1);
    expect(tests[0]?.statistic).toBeCloseTo(-2.11, 10);
  });
});

describe('checkNhstTest', () => {
  it('accepts a correctly reported test', () => {
    const [test] = extractNhstTests('t(28) = 2.20, p = .036');
    const verdict = checkNhstTest(test!);
    expect(verdict?.consistent).toBe(true);
  });

  it('flags an inconsistent p without a decision error when both sides stay significant', () => {
    const [test] = extractNhstTests('t(37) = 2.05, p = .04');
    const verdict = checkNhstTest(test!);
    expect(verdict?.consistent).toBe(false);
    expect(verdict?.decisionError).toBe(false);
  });

  it('flags a decision error when the recomputed p crosses .05', () => {
    const [test] = extractNhstTests('t(28) = 2.20, p = .30');
    const verdict = checkNhstTest(test!);
    expect(verdict?.consistent).toBe(false);
    expect(verdict?.decisionError).toBe(true);
  });

  it('recognises when a one-tailed reading explains the mismatch', () => {
    const [test] = extractNhstTests('t(28) = 1.75, p = .046');
    const verdict = checkNhstTest(test!);
    expect(verdict?.consistent).toBe(false);
    expect(verdict?.oneTailedExplains).toBe(true);
  });

  it('honours the p < comparator', () => {
    const [test] = extractNhstTests('χ2(1) = 4.68, p < .05');
    expect(checkNhstTest(test!)?.consistent).toBe(true);
  });
});

describe('grimCheck', () => {
  it('accepts a mean an integer total can produce', () => {
    expect(grimCheck(5.18, 28, 2)).toBe(true);
  });

  it('rejects a mean no integer total can produce', () => {
    expect(grimCheck(5.19, 28, 2)).toBe(false);
  });

  it('skips when the sample is too large for the reported precision to discriminate', () => {
    expect(grimCheck(5.19, 200, 2)).toBe(true);
  });
});

describe('extractGrimCandidates', () => {
  it('pairs a mean and sample size only inside the same parenthetical', () => {
    const text = 'The treated group scored higher (M = 5.19, SD = 1.34, n = 28). Overall n = 300 across sites.';
    const candidates = extractGrimCandidates(text);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.mean).toBeCloseTo(5.19, 10);
    expect(candidates[0]?.n).toBe(28);
  });
});

function sectionMapWith(text: string): SectionMap {
  return {
    title: 'Fixture',
    abstract: null,
    sections: [
      {
        index: 0,
        heading: 'Results',
        text,
        lineStart: 1,
        lineEnd: 40,
      },
    ],
    references: [],
    parser: 'grobid',
    parseQuality: 'good',
  } as unknown as SectionMap;
}

describe('deterministicStatsFindings', () => {
  it('produces schema-valid ledger fragments for a seeded inconsistency', () => {
    const findings = deterministicStatsFindings(
      sectionMapWith('The effect was significant, t(28) = 2.20, p = .30, and robust (M = 5.19, SD = 1.34, n = 28).'),
    );
    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(() => findingSchema.parse(finding)).not.toThrow();
    }
    const decision = findings.find((finding) => finding.severity === 'major');
    expect(decision?.scope).toBe('editor-only');
    expect(decision?.anchor).toContain('Results');
  });

  it('returns nothing for a clean excerpt', () => {
    const findings = deterministicStatsFindings(
      sectionMapWith('The effect was significant, t(28) = 2.20, p = .036, in the treated group (M = 5.18, SD = 1.34, n = 28).'),
    );
    expect(findings).toHaveLength(0);
  });
});
