import { RUBRIC_CRITERIA } from '@mara/shared';
import { describe, expect, it } from 'vitest';
import { readKnowledgeModule } from '../../prompts/knowledge';

describe('rubric criteria stay in sync with knowledge/03', () => {
  it('matches every criterion name in the decision-module table', () => {
    const md = readKnowledgeModule('03_REVIEW_DECISION.md');
    const rows = md
      .split('\n')
      .map((line) => line.match(/^\|\s*(\d{1,2})\s*\|\s*([^|]+?)\s*\|/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => ({ index: Number(match[1]), name: (match[2] ?? '').trim() }))
      .filter((row) => row.index >= 1 && row.index <= 15);

    expect(rows).toHaveLength(15);
    for (const row of rows) {
      const criterion = RUBRIC_CRITERIA.find((entry) => entry.index === row.index);
      expect(criterion?.name).toBe(row.name);
    }
  });
});
