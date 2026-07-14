import { describe, expect, it } from 'vitest';
import { loadBannedVerdictTerms, redactEditorOnlyIds, redactSupersededIds, validateGrounding } from '../grounding';

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
