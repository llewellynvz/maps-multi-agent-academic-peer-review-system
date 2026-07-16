import { describe, expect, it } from 'vitest';
import { crossReviewSimilarity, jaccard, normaliseForSimilarity, shingles } from '../similarity';

describe('shingle similarity primitives', () => {
  it('lowercases and tokenises on word boundaries', () => {
    expect(normaliseForSimilarity('The MEAN, Table 2.')).toEqual(['the', 'mean', 'table', '2']);
  });

  it('builds overlapping n-grams', () => {
    expect(shingles(['a', 'b', 'c', 'd'], 2)).toEqual(new Set(['a b', 'b c', 'c d']));
  });

  it('scores identical sets as 1 and disjoint sets as 0', () => {
    expect(jaccard(new Set(['a b']), new Set(['a b']))).toBe(1);
    expect(jaccard(new Set(['a b']), new Set(['c d']))).toBe(0);
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });
});

describe('crossReviewSimilarity', () => {
  it('flags two near-identical letters as template reuse and leaves distinct ones low', () => {
    const shared = 'The manuscript reports a cross-sectional design and the causal claim cannot be supported by the evidence on the page here today.';
    const report = crossReviewSimilarity(
      [
        { id: 'a', text: `${shared} The sampling frame is under-described in the methods section.` },
        { id: 'b', text: `${shared} The mediation model omits its indirect effect entirely.` },
        { id: 'c', text: 'A wholly different review about measurement invariance and factor structure with no shared phrasing whatsoever.' },
      ],
      { shingleSize: 6, threshold: 0.2 },
    );
    expect(report.count).toBe(3);
    expect(report.pairs).toHaveLength(3);
    const ab = report.pairs.find((pair) => pair.a === 'a' && pair.b === 'b');
    const ac = report.pairs.find((pair) => (pair.a === 'a' && pair.b === 'c') || (pair.a === 'c' && pair.b === 'a'));
    expect(ab!.similarity).toBeGreaterThan(0.2);
    expect(ac!.similarity).toBeLessThan(0.2);
    expect(report.aboveThreshold.map((pair) => [pair.a, pair.b])).toContainEqual(['a', 'b']);
    expect(report.max).toBe(report.pairs[0]!.similarity);
  });

  it('returns an empty report for fewer than two letters', () => {
    const report = crossReviewSimilarity([{ id: 'only', text: 'one letter' }]);
    expect(report.pairs).toEqual([]);
    expect(report.mean).toBe(0);
    expect(report.aboveThreshold).toEqual([]);
  });
});
