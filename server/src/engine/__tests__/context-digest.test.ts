import type { SectionMap } from '@mara/shared';
import { describe, expect, it } from 'vitest';
import { manuscriptDigest } from '../context';

function longSectionMap(): SectionMap {
  return {
    title: 'A Long Manuscript',
    abstract: 'Short abstract.',
    sections: Array.from({ length: 8 }, (_, index) => ({
      index,
      heading: `Section ${index + 1}`,
      text: 'lorem '.repeat(1200),
      lineStart: index * 100 + 1,
      lineEnd: index * 100 + 99,
    })),
    references: [],
    parser: 'grobid',
    parseQuality: 'good',
  } as unknown as SectionMap;
}

describe('manuscriptDigest preset limits', () => {
  it('gives the thorough preset a deeper digest than fast and balanced', () => {
    const sectionMap = longSectionMap();
    const fast = manuscriptDigest(sectionMap, 'fast');
    const balanced = manuscriptDigest(sectionMap, 'balanced');
    const thorough = manuscriptDigest(sectionMap, 'thorough');

    expect(fast.length).toBe(balanced.length);
    expect(balanced.length).toBe(16000);
    expect(thorough.length).toBe(32000);
    expect(manuscriptDigest(sectionMap)).toHaveLength(balanced.length);
  });
});
