import { describe, expect, it } from 'vitest';
import {
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
