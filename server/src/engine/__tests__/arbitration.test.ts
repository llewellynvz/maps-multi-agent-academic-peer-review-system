import { describe, expect, it } from 'vitest';
import { arbitrate, type ArbitrationInput, narrowRecommendation } from '../arbitration';

const ledgerIds = new Set(['REV-STAT-0001', 'REV-METH-0002']);

function base(): ArbitrationInput {
  return {
    objection: 'severity softened relative to the ledger',
    lastGroundingFailureKind: null,
    confidentialityOrVerdictObjection: false,
    recommendation: 'major_revision',
    decisionHingeIds: ['REV-STAT-0001', 'REV-METH-0002'],
    ledgerIds,
    openFatalIds: [],
    openMajorIds: ['REV-STAT-0001'],
  };
}

describe('deterministic arbitration', () => {
  it('narrows the recommendation down never up', () => {
    expect(narrowRecommendation('accept')).toBe('minor_revision');
    expect(narrowRecommendation('major_revision')).toBe('reject_and_resubmit');
    expect(narrowRecommendation('reject')).toBe('reject');
  });

  it('forces halt on a confidentiality or verdict-term objection', () => {
    const input = base();
    input.confidentialityOrVerdictObjection = true;
    const record = arbitrate(input);
    expect(record.outcome).toBe('halt');
  });

  it('forces halt when a grounding leak or banned term was the last failure', () => {
    const input = base();
    input.lastGroundingFailureKind = 'editor-only-leak';
    expect(arbitrate(input).outcome).toBe('halt');
  });

  it('forces halt when the final cycle deliverable is still ungrounded', () => {
    const input = base();
    input.lastGroundingFailureKind = 'ungrounded-id';
    expect(arbitrate(input).outcome).toBe('halt');
  });

  it('halts when the recommendation rationale cannot be grounded in the ledger', () => {
    const input = base();
    input.decisionHingeIds = ['REV-XXX-9999'];
    const record = arbitrate(input);
    expect(record.outcome).toBe('halt');
    expect(record.evidenceIds).toHaveLength(0);
  });

  it('accepts and narrows when an open finding bounds the objection', () => {
    const record = arbitrate(base());
    expect(record.outcome).toBe('accept-and-narrow');
    expect(record.narrowedRecommendation).toBe('reject_and_resubmit');
    expect(record.evidenceIds).toContain('REV-STAT-0001');
  });

  it('overrules with named evidence when fully grounded and no open fatal contradicts', () => {
    const input = base();
    input.openMajorIds = [];
    const record = arbitrate(input);
    expect(record.outcome).toBe('overrule-with-named-evidence');
    expect(record.evidenceIds.length).toBeGreaterThan(0);
    expect(record.evidenceIds.every((id) => ledgerIds.has(id))).toBe(true);
  });

  it('never overrules without at least one ledger finding id (PIPE-17)', () => {
    const record = arbitrate(base());
    if (record.outcome === 'overrule-with-named-evidence') {
      expect(record.evidenceIds.length).toBeGreaterThan(0);
    } else {
      expect(record.outcome).not.toBe('overrule-with-named-evidence');
    }
  });
});
