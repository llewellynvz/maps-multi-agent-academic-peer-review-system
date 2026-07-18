import type { SectionMap } from '@mara/shared';
import { describe, expect, it } from 'vitest';
import { manuscriptDigest } from '../context';

function giantSingleSection(): SectionMap {
  return {
    title: 'A Long Manuscript',
    abstract: 'Short abstract.',
    sections: [{ index: 0, heading: null, text: 'lorem '.repeat(40000), lineStart: 1, lineEnd: 100 }],
    references: [],
    parser: 'grobid',
    parseQuality: 'good',
  } as unknown as SectionMap;
}

function shortManuscript(): SectionMap {
  return {
    title: 'A Short Manuscript',
    abstract: 'Short abstract.',
    sections: Array.from({ length: 4 }, (_, index) => ({
      index,
      heading: `Section ${index + 1}`,
      text: `body-${index}-` + 'lorem '.repeat(300),
      lineStart: index * 100 + 1,
      lineEnd: index * 100 + 99,
    })),
    references: [],
    parser: 'grobid',
    parseQuality: 'good',
  } as unknown as SectionMap;
}

describe('manuscriptDigest preset limits', () => {
  it('reads far more of a long single-section manuscript than the old fixed clip', () => {
    // Regression: a manuscript that parsed into one giant section used to be clipped to
    // ~2400 characters, so reviewers saw only the opening. It must now be read in depth.
    const balanced = manuscriptDigest(giantSingleSection(), 'balanced');
    expect(balanced.length).toBeGreaterThan(50000);
  });

  it('gives each preset a deeper budget as the tier rises', () => {
    const map = giantSingleSection();
    const fast = manuscriptDigest(map, 'fast');
    const balanced = manuscriptDigest(map, 'balanced');
    const thorough = manuscriptDigest(map, 'thorough');

    expect(fast.length).toBeLessThan(balanced.length);
    expect(balanced.length).toBeLessThan(thorough.length);
    expect(manuscriptDigest(map)).toHaveLength(balanced.length);
  });

  it('includes every section in full when the manuscript fits the budget', () => {
    const map = shortManuscript();
    const balanced = manuscriptDigest(map, 'balanced');

    for (const section of map.sections) {
      expect(balanced).toContain(section.text);
    }
    expect(balanced).not.toContain('[section truncated]');
  });

  it('stays within the total budget and shows every section when many sections overflow', () => {
    const map = {
      title: 'Long',
      abstract: null,
      sections: Array.from({ length: 40 }, (_, index) => ({
        index,
        heading: `Section ${index + 1}`,
        text: `marker-${index}-` + 'lorem '.repeat(700),
        lineStart: index * 100 + 1,
        lineEnd: index * 100 + 99,
      })),
      references: [],
      parser: 'grobid',
      parseQuality: 'good',
    } as unknown as SectionMap;

    const balanced = manuscriptDigest(map, 'balanced');
    expect(balanced.length).toBeLessThanOrEqual(64000);
    for (const section of map.sections) {
      expect(balanced).toContain(`## ${section.heading}`);
    }
    expect(balanced).toContain('[section truncated]');
  });

  it('caps the digest at an explicit maxChars below the preset budget', () => {
    const map = giantSingleSection();
    const capped = manuscriptDigest(map, 'thorough', 30000);
    expect(capped.length).toBeLessThanOrEqual(30000);
    expect(capped.length).toBeLessThan(manuscriptDigest(map, 'thorough').length);
  });
});
