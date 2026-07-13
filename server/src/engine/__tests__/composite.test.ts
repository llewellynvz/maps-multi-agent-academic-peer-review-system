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
      bodyMarkdown: 'Finding REV-STAT-0001 names the validity threat, and its leanest fix is to recompute the descriptives.',
      decisionStability: 1,
    });
    expect(result.components.evidenceGrounding).toBe(1);
    expect(result.components.actionability).toBe(1);
    expect(result.components.unsupportedClaim).toBe(0);
    expect(result.toneRiskHits).toBe(0);
    expect(result.positiveCeiling).toBeCloseTo(0.9, 6);
    expect(result.composite).toBeCloseTo(0.9, 6);
  });

  it('penalises banned destructive phrasing through the tone-risk component', () => {
    const result = computeComposite({
      currentFindings: [finding()],
      ledgerIds: new Set(['REV-STAT-0001']),
      citedFindingIds: ['REV-STAT-0001'],
      bodyMarkdown: 'Per REV-STAT-0001 the authors fail to address the confound and the work is poorly written throughout.',
      decisionStability: 1,
    });
    expect(result.toneRiskHits).toBeGreaterThanOrEqual(1);
    expect(result.components.toneRisk).toBeLessThan(1);
    expect(result.composite).toBeLessThan(0.9);
  });

  it('keeps the unsupported-claim penalty independent of the grounding rate', () => {
    const grounded = new Set(['REV-STAT-0001']);
    const citesEveryClaim = computeComposite({
      currentFindings: [finding()],
      ledgerIds: grounded,
      citedFindingIds: ['REV-STAT-0001'],
      bodyMarkdown: 'The central concern is captured by REV-STAT-0001 and its recomputation fix resolves the threat.',
      decisionStability: 1,
    });
    const uncitedProse = computeComposite({
      currentFindings: [finding()],
      ledgerIds: grounded,
      citedFindingIds: ['REV-STAT-0001'],
      bodyMarkdown:
        'The manuscript reports a strong effect on wellbeing that the discussion treats as decisive across the board.',
      decisionStability: 1,
    });
    expect(citesEveryClaim.components.evidenceGrounding).toBe(1);
    expect(uncitedProse.components.evidenceGrounding).toBe(1);
    expect(citesEveryClaim.components.unsupportedClaim).toBe(0);
    expect(uncitedProse.components.unsupportedClaim).toBeGreaterThan(0);
  });

  it('drops the grounding rate when a cited id is not in the ledger', () => {
    const result = computeComposite({
      currentFindings: [finding()],
      ledgerIds: new Set(['REV-STAT-0001']),
      citedFindingIds: ['REV-STAT-0001', 'REV-GHOST-0001'],
      bodyMarkdown: 'A report citing REV-STAT-0001 and a ghost id.',
      decisionStability: 0.5,
    });
    expect(result.components.evidenceGrounding).toBeCloseTo(0.5, 6);
  });

  it('loads the banned phrasing list from knowledge/04', () => {
    const banned = loadBannedPhrases();
    expect(banned.length).toBeGreaterThan(0);
    expect(banned).toContain('the authors fail to');
  });
});
