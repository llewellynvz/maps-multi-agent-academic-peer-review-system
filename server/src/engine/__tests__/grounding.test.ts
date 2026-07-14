import { describe, expect, it } from 'vitest';
import {
  loadBannedVerdictTerms,
  redactEditorOnlyIds,
  redactSupersededIds,
  scanMachineTokens,
  validateGrounding,
} from '../grounding';

const ledgerIds = new Set(['REV-STAT-0001', 'REV-MAP-0001', 'REV-SIM-0001']);
const editorOnlyIds = new Set(['REV-SIM-0001']);

function base() {
  return {
    authorFacingBody: 'The manuscript reports REV-STAT-0001 with a concern anchored in REV-MAP-0001.',
    authorFacingCitedIds: ['REV-STAT-0001', 'REV-MAP-0001'],
    privateNotesBody: 'Editorial signal REV-SIM-0001 warrants editorial review.',
    privateNotesReferencedIds: ['REV-SIM-0001'],
    ledgerIds,
    editorOnlyIds,
  };
}

describe('deterministic grounding validator', () => {
  it('passes a clean pair of documents', () => {
    const result = validateGrounding(base());
    expect(result.ok).toBe(true);
    expect(result.kind).toBeNull();
  });

  it('catches a planted ungrounded finding id', () => {
    const input = base();
    input.authorFacingCitedIds = ['REV-STAT-0001', 'REV-ZZZ-9999'];
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('ungrounded-id');
    expect(result.failures.join(' ')).toContain('REV-ZZZ-9999');
  });

  it('ignores id-shaped tokens inside quarantine markers quoted from the manuscript', () => {
    const input = base();
    input.authorFacingBody = 'The abstract carries the marker [[QUARANTINED:REV-SAN-0001]] which the authors must address.';
    input.privateNotesBody = "Anchor: Abstract, marker '[QUARANTINED:REV-SAN-0001]'.";
    const result = validateGrounding(input);
    expect(result.ok).toBe(true);
  });

  it('still catches a naked stale id even when a quarantine marker is present', () => {
    const input = base();
    input.authorFacingBody = 'See [[QUARANTINED:REV-SAN-0001]] and also the earlier REV-SAN-0001 reading.';
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('ungrounded-id');
  });

  it('masks superseded ids in artefact content while keeping current ids', () => {
    const current = new Set(['REV-STAT-0001']);
    const masked = redactSupersededIds('Cites REV-STAT-0001 and stale REV-STAT-0009.', current);
    expect(masked).toContain('REV-STAT-0001');
    expect(masked).not.toContain('REV-STAT-0009');
    expect(masked).toContain('[SUPERSEDED]');
  });

  it('catches a planted editor-only id leaked into author-facing text', () => {
    const input = base();
    input.authorFacingBody = 'The manuscript reports REV-STAT-0001 and the signal REV-SIM-0001.';
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('editor-only-leak');
    expect(result.failures.join(' ')).toContain('REV-SIM-0001');
  });

  it('catches planted banned verdict terminology in author-facing text', () => {
    const input = base();
    input.authorFacingBody = 'The results appear fabricated and the manuscript is fraudulent.';
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('banned-verdict-term');
  });

  it('does not false-positive on a benign word that contains a banned term', () => {
    const input = base();
    input.authorFacingBody = 'The prefabricated survey items are described in Section 3 (REV-STAT-0001).';
    const result = validateGrounding(input);
    expect(result.ok).toBe(true);
  });

  it('sources the banned verdict list from knowledge/01 at runtime', () => {
    const terms = loadBannedVerdictTerms();
    expect(terms.length).toBeGreaterThan(0);
    expect(terms).toContain('fabricated');
  });

  it('redacts every occurrence of editor-only ids from artefact content', () => {
    const content = 'Signal REV-SIM-0001 recurs; see REV-SIM-0001 in JSON {"id":"REV-SIM-0001"} beside REV-STAT-0001.';
    const redacted = redactEditorOnlyIds(content, editorOnlyIds);
    expect(redacted).not.toContain('REV-SIM-0001');
    expect(redacted).toContain('REV-STAT-0001');
    expect(redacted.match(/\[EDITOR-ONLY\]/g)?.length).toBe(3);
  });

  it('leaves content untouched when there are no editor-only ids', () => {
    const content = 'Only REV-STAT-0001 here.';
    expect(redactEditorOnlyIds(content, new Set())).toBe(content);
  });
});

function idFreeBase() {
  return {
    authorFacingBody:
      '**Causal claims on a cross-sectional design.** The abstract says engagement drives performance. I recommend rejection with an invitation to resubmit, and I hold this with high confidence.',
    authorFacingCitedIds: ['REV-STAT-0001', 'REV-MAP-0001'],
    privateNotesBody: 'Editorial signal REV-SIM-0001 warrants editorial review.',
    privateNotesReferencedIds: ['REV-SIM-0001'],
    ledgerIds,
    editorOnlyIds,
    idFreeProse: true,
    evidenceMap: [
      {
        section: '4A.1',
        label: 'Causal claims on a cross-sectional design.',
        anchor: 'Abstract; Section 5.2',
        findingIds: ['REV-STAT-0001', 'REV-MAP-0001'],
      },
    ],
  };
}

describe('id-free prose and evidence map validation', () => {
  it('passes a clean id-free report with a matching evidence map', () => {
    const result = validateGrounding(idFreeBase());
    expect(result.ok).toBe(true);
    expect(result.kind).toBeNull();
  });

  it('fails when a finding id appears inline in the shipped prose', () => {
    const input = idFreeBase();
    input.authorFacingBody += ' See REV-STAT-0001 for the coefficient concern.';
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('id-in-prose');
    expect(result.failures.join(' ')).toContain('REV-STAT-0001');
  });

  it('still ignores quarantine markers under id-free prose', () => {
    const input = idFreeBase();
    input.authorFacingBody += ' The abstract carries the marker [[QUARANTINED:REV-SAN-0001]].';
    const result = validateGrounding(input);
    expect(result.ok).toBe(true);
  });

  it('fails on a taxonomy token in shipped prose', () => {
    const input = idFreeBase();
    input.authorFacingBody += ' The category is reject_and_resubmit.';
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('machine-token');
  });

  it('fails on a key-value decision line', () => {
    const input = idFreeBase();
    input.authorFacingBody += '\nDecision: reject and resubmit | Confidence: high';
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('machine-token');
  });

  it('fails on a bare numeric confidence in prose', () => {
    const input = idFreeBase();
    input.authorFacingBody += ' I hold this recommendation at a confidence of 0.78 overall.';
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('machine-token');
  });

  it('does not flag confidence intervals or reliability statistics in expert prose', () => {
    const prose = [
      'The 95% confidence interval was [0.02, 0.19], excluding zero only narrowly.',
      'A confidence interval of 0.45 to 0.78 spans the benchmark.',
      'My confidence in the 0.82 alpha depends on the item set.',
    ].join(' ');
    expect(scanMachineTokens(prose)).toHaveLength(0);
    const input = idFreeBase();
    input.authorFacingBody += ` ${prose}`;
    expect(validateGrounding(input).ok).toBe(true);
  });

  it('does not flag bold lead-in labels, but still catches bullet and pipe key-value lines', () => {
    expect(scanMachineTokens('**Recommendation:** I recommend major revision.\n**Severity:** the concern is structural.')).toHaveLength(0);
    expect(scanMachineTokens('* Decision: reject and resubmit').length).toBeGreaterThan(0);
    expect(scanMachineTokens('1. Decision: reject and resubmit').length).toBeGreaterThan(0);
    expect(scanMachineTokens('I recommend rejection | Confidence: high').length).toBeGreaterThan(0);
  });

  it('still catches an explicit numeric recommendation confidence', () => {
    expect(scanMachineTokens('I hold this at confidence 0.78 overall.').length).toBeGreaterThan(0);
    expect(scanMachineTokens('Confidence: 0.78').length).toBeGreaterThan(0);
    expect(scanMachineTokens('My confidence was 0.9 here.').length).toBeGreaterThan(0);
    expect(scanMachineTokens('**Confidence:** 0.78').length).toBeGreaterThan(0);
  });

  it('does not flag natural confidence prose or a DOI in the references', () => {
    const input = idFreeBase();
    input.authorFacingBody +=
      ' I say this with moderate confidence. https://doi.org/10.1037/some_thing.2020 sits in the reference list.';
    const tokens = scanMachineTokens(input.authorFacingBody);
    expect(tokens).toHaveLength(0);
    expect(validateGrounding(input).ok).toBe(true);
  });

  it('fails when the evidence map cites an id missing from the ledger', () => {
    const input = idFreeBase();
    input.evidenceMap[0]!.findingIds = ['REV-STAT-0001', 'REV-ZZZ-9999'];
    input.authorFacingCitedIds = ['REV-STAT-0001', 'REV-ZZZ-9999'];
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('evidence-map-mismatch');
  });

  it('fails when the evidence map cites an editor-only id', () => {
    const input = idFreeBase();
    input.evidenceMap[0]!.findingIds = ['REV-STAT-0001', 'REV-SIM-0001'];
    input.authorFacingCitedIds = ['REV-STAT-0001', 'REV-SIM-0001'];
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('editor-only');
  });

  it('fails when citedFindingIds diverge from the union of map ids', () => {
    const input = idFreeBase();
    input.authorFacingCitedIds = ['REV-STAT-0001'];
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('evidence-map-mismatch');
    expect(result.failures.join(' ')).toContain('union');
  });

  it('fails when a map label is not a bold label in the body', () => {
    const input = idFreeBase();
    input.evidenceMap[0]!.label = 'A label the body never bolds.';
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('evidence-map-mismatch');
    expect(result.failures.join(' ')).toContain('bold label');
  });

  it('catches a finding id hidden in the rubric justifications', () => {
    const input = { ...idFreeBase(), authorFacingAncillary: 'Score grounded in REV-STAT-0001.' };
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('id-in-prose');
  });

  it('catches a machine token hidden in the rubric justifications', () => {
    const input = { ...idFreeBase(), authorFacingAncillary: 'Holds unless the category falls to reject_and_resubmit.' };
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('machine-token');
  });

  it('keeps legacy behaviour when idFreeProse and evidenceMap are absent', () => {
    const result = validateGrounding(base());
    expect(result.ok).toBe(true);
  });
});
