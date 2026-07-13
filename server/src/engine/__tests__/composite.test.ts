import { describe, expect, it } from 'vitest';
import type { CurrentFinding } from '../../ledger';
import { COMPOSITE_WEIGHTS, computeComposite, loadBannedPhrases } from '../composite';

function finding(overrides: Partial<CurrentFinding> = {}): CurrentFinding {
  return {
    id: 'REV-STAT-0001',
    reviewId: 'r',
    agent: 'specialist-reviewer',
    phase: 'phase_3',
    type: 'statistical',
    claim: 'A statistical concern.',
    manuscriptAnchor: 'Table 2',
    epistemicStatus: 'Known',
    confidence: 0.9,
    confidenceBand: 'Yellow',
    severity: 'major',
    fixability: 'moderate',
    scope: 'both',
    narrativeContext: 'A validity threat.',
    recommendedAction: 'Recompute the descriptives.',
    supersedesId: null,
    createdAt: '2026-07-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('quality composite', () => {
  it('records five weights that sum to 1.0', () => {
    const sum =
      COMPOSITE_WEIGHTS.evidenceGrounding +
      COMPOSITE_WEIGHTS.actionability +
      COMPOSITE_WEIGHTS.decisionStability +
      COMPOSITE_WEIGHTS.toneRisk +
      COMPOSITE_WEIGHTS.unsupportedClaim;
    expect(sum).toBeCloseTo(1, 10);
  });

  it('reaches the 0.90 positive ceiling when grounding, actionability, stability, and tone are perfect', () => {
    const result = computeComposite({
      currentFindings: [finding()],
      ledgerIds: new Set(['REV-STAT-0001']),
      citedFindingIds: ['REV-STAT-0001'],
      bodyMarkdown: 'A clean developmental report that names the validity threat and its leanest fix.',
      decisionStability: 1,
    });
    expect(result.components.evidenceGrounding).toBe(1);
    expect(result.components.actionability).toBe(1);
    expect(result.components.unsupportedClaim).toBe(0);
    expect(result.toneRiskHits).toBe(0);
    expect(result.composite).toBeCloseTo(0.9, 6);
  });

  it('penalises banned destructive phrasing through the tone-risk component', () => {
    const result = computeComposite({
      currentFindings: [finding()],
      ledgerIds: new Set(['REV-STAT-0001']),
      citedFindingIds: ['REV-STAT-0001'],
      bodyMarkdown: 'The authors fail to address the confound and the work is poorly written.',
      decisionStability: 1,
    });
    expect(result.toneRiskHits).toBeGreaterThanOrEqual(1);
    expect(result.components.toneRisk).toBeLessThan(1);
    expect(result.composite).toBeLessThan(0.9);
  });

  it('drops grounding and applies the penalty for a claim with no ledger id', () => {
    const result = computeComposite({
      currentFindings: [finding()],
      ledgerIds: new Set(['REV-STAT-0001']),
      citedFindingIds: ['REV-STAT-0001', 'REV-GHOST-0001'],
      bodyMarkdown: 'A report citing a ghost id.',
      decisionStability: 0.5,
    });
    expect(result.components.evidenceGrounding).toBeCloseTo(0.5, 6);
    expect(result.components.unsupportedClaim).toBeCloseTo(0.5, 6);
  });

  it('loads the banned phrasing list from knowledge/04', () => {
    const banned = loadBannedPhrases();
    expect(banned.length).toBeGreaterThan(0);
    expect(banned).toContain('the authors fail to');
  });
});
