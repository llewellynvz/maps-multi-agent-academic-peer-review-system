import { describe, expect, it } from 'vitest';
import { groundingKindsForceHalt } from '../arbitration';
import {
  humanizePairFailures,
  loadBannedVerdictTerms,
  narrativeWordCount,
  redactEditorOnlyIds,
  redactSupersededIds,
  sanitiseAuthorFacingBody,
  scanAiTropes,
  scanMachineTokens,
  scrubProsePunctuation,
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

  it('fails when a map label is neither a bold label nor a heading in the body', () => {
    const input = idFreeBase();
    input.evidenceMap[0]!.label = 'A label the body never bolds.';
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('evidence-map-mismatch');
    expect(result.failures.join(' ')).toContain('bold label or section heading');
  });

  it('rejects a map label that is only a prefix of a longer bold run', () => {
    const input = idFreeBase();
    input.evidenceMap[0]!.label = 'Sampling';
    input.authorFacingBody += '\n\n**Sampling frame differs from the target population.** Detail follows.';
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('evidence-map-mismatch');
  });

  it('rejects a map label that only loosely resembles a semantically different heading', () => {
    const input = idFreeBase();
    input.evidenceMap[0]!.label = 'Measurement reliability of the outcome scale';
    input.authorFacingBody += '\n\n### 4A.4 Measurement invariance of the outcome scale\nDetail follows.';
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('evidence-map-mismatch');
  });

  it('accepts a map label carried by a numbered section heading', () => {
    const input = idFreeBase();
    input.authorFacingBody +=
      '\n\n### 4A.1 Over-strong causal framing for a single waitlist trial (fatal if unresolved)\nThe trial cannot carry the causal weight placed on it.\n\n### Discussion calibration of claims and implications\nThe Discussion reads durability into a single post-test.';
    input.evidenceMap.push(
      {
        section: '4A.1',
        label: 'Over-strong causal framing for a single waitlist trial (fatal if unresolved)',
        anchor: 'Abstract; Section 5',
        findingIds: ['REV-STAT-0001'],
      },
      {
        section: '4B Discussion',
        label: 'Discussion calibration of claims and implications',
        anchor: 'Section 5',
        findingIds: ['REV-MAP-0001'],
      },
    );
    const result = validateGrounding(input);
    expect(result.ok).toBe(true);
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

  it('matches labels across unicode hyphen and quote variants', () => {
    const input = idFreeBase();
    input.authorFacingBody += '\n\n### 4A.4 Statistical model under‑reported and over‑interpreted (major)\nDetail follows.';
    input.evidenceMap.push({
      section: '4A.4',
      label: 'Statistical model under-reported and over-interpreted (major)',
      anchor: 'Section 3',
      findingIds: ['REV-MAP-0001'],
    });
    const result = validateGrounding(input);
    expect(result.ok).toBe(true);
  });

  it('tolerates a trailing full stop on the map label that the heading lacks', () => {
    const input = idFreeBase();
    input.authorFacingBody += '\n\n### 4A.4 Overstated global effectiveness claims (major)\nDetail follows.';
    input.evidenceMap.push({
      section: '4A.4',
      label: 'Overstated global effectiveness claims (major).',
      anchor: 'Abstract',
      findingIds: ['REV-MAP-0001'],
    });
    expect(validateGrounding(input).ok).toBe(true);
  });

  it('fails the shipped body on AI-writing tells the humanize pass should remove', () => {
    const input = idFreeBase();
    input.authorFacingBody +=
      ' Furthermore, the design plays a crucial role here, and it is worth noting the gap.';
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('ai-trope');
  });

  it('catches AI tells in the rubric justifications too', () => {
    const input = {
      ...idFreeBase(),
      authorFacingAncillary: 'The measure sheds light on the construct, a testament to careful design.',
    };
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('ai-trope');
  });

  it('catches the summary-transition and noted-that tells without touching a genuine closing sign-off', () => {
    const input = idFreeBase();
    input.authorFacingBody +=
      ' In conclusion, this is competent. It should be noted that the sample skews young.';
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe('ai-trope');
    expect(scanAiTropes('In closing, I encourage a second wave. The overall fit was poor. The authors note that attrition was high.')).toEqual([]);
  });

  it('does not flag legitimate expert review prose that engages the literature', () => {
    const input = idFreeBase();
    input.authorFacingBody =
      '**Causal claims on a cross-sectional design.** The design cannot support the mediation claim. ' +
      'Bakker and Demerouti (2017) show that a robust standard error does not license a causal reading, ' +
      'and your comprehensive coverage of the JD-R literature makes the novel contribution harder to locate. ' +
      'The core problem is the temporal ordering, which the additional wave of data would resolve. ' +
      'I recommend rejection with an invitation to resubmit, held with high confidence.';
    input.evidenceMap[0]!.anchor = 'Section 5.2';
    const tropes = scanAiTropes(input.authorFacingBody);
    expect(tropes).toEqual([]);
    expect(validateGrounding(input).ok).toBe(true);
  });

  it('keeps legacy behaviour when idFreeProse and evidenceMap are absent', () => {
    const result = validateGrounding(base());
    expect(result.ok).toBe(true);
  });

  it('reports every distinct failure kind, not only the last one', () => {
    const input = idFreeBase();
    input.authorFacingBody =
      '**Causal claims on a cross-sectional design.** See REV-STAT-0001. Furthermore, it plays a crucial role.';
    const result = validateGrounding(input);
    expect(result.ok).toBe(false);
    expect(result.kinds).toContain('id-in-prose');
    expect(result.kinds).toContain('ai-trope');
  });
});

describe('deterministic author-facing scrub', () => {
  it('removes a structured decision line so it never reaches the gate', () => {
    const { body, removed } = sanitiseAuthorFacingBody(
      'I recommend major revision, held with high confidence.\n- Decision: minor_revision\nThe design is sound.',
    );
    expect(scanMachineTokens(body)).toHaveLength(0);
    expect(removed.join(' ')).toContain('Decision');
    expect(body).toContain('The design is sound.');
  });

  it('drops a connective opener and capitalises the next word, keeping the sentence', () => {
    const { body } = sanitiseAuthorFacingBody('The model is thin. Overall, the evidence is weak.');
    expect(body).toBe('The model is thin. The evidence is weak.');
    expect(scanAiTropes(body)).toHaveLength(0);
  });

  it('reproduces the 4346ead3 halt cause: decision line removed, banned term and mid-sentence connective neutralised', () => {
    const raw = 'The design is weak. Overall, this is a paradigm shift for the field.\n- Decision: minor_revision';
    const { body } = sanitiseAuthorFacingBody(raw);
    expect(scanMachineTokens(body)).toHaveLength(0);
    expect(body).not.toContain('paradigm shift');
    expect(body).not.toMatch(/\boverall,/i);
    expect(body).toContain('The design is weak.');
  });

  it('leaves clean prose and legitimate bold labels untouched', () => {
    const clean = '**Causal claims on a cross-sectional design.** The design cannot carry the mediation claim.';
    expect(sanitiseAuthorFacingBody(clean).body).toBe(clean);
  });

  it('never rewrites a bold problem label that opens with a connective, so the evidence map stays in sync', () => {
    const label = 'Importantly, the mediation is unidentified.';
    const body = `Dear Editor and Authors, I recommend major revision.\n\n**${label}** The instrument cannot separate the paths.`;
    const scrubbed = sanitiseAuthorFacingBody(body);
    expect(scrubbed.body).toContain(`**${label}**`);
    const result = validateGrounding({
      authorFacingBody: scrubbed.body,
      authorFacingCitedIds: ['REV-STAT-0001'],
      privateNotesBody: '',
      privateNotesReferencedIds: [],
      ledgerIds,
      editorOnlyIds,
      idFreeProse: true,
      evidenceMap: [{ section: '4A.1', label, anchor: 'Section 5', findingIds: ['REV-STAT-0001'] }],
    });
    expect(result.kinds).not.toContain('evidence-map-mismatch');
  });

  it('does not corrupt a mixed-case or hyphenated token after a stripped connective', () => {
    expect(sanitiseAuthorFacingBody('The build failed. Overall, iOS crashed on launch.').body).toContain('iOS');
    expect(sanitiseAuthorFacingBody('The test ran. Notably, p-values exceeded 0.05.').body).toContain('p-values');
  });

  it('keeps real prose on a mislabelled recommendation line, dropping only the label prefix', () => {
    const { body } = sanitiseAuthorFacingBody('Recommendation: collect a second wave before the causal claim can stand.');
    expect(body).toBe('Collect a second wave before the causal claim can stand.');
    expect(scanMachineTokens(body)).toHaveLength(0);
  });

  it('humanises internal enum tokens so they never ship to the author', () => {
    const { body } = sanitiseAuthorFacingBody('The evidence points to major_revision, not editor_only handling.');
    expect(body).not.toMatch(/major_revision|editor_only/);
    expect(body).toContain('major revision');
    expect(body).toContain('editorial');
    expect(scanMachineTokens(body)).toHaveLength(0);
  });

  it('removes an inline pipe key-value and strips a numeric confidence', () => {
    expect(sanitiseAuthorFacingBody('I recommend rejection | Confidence: high').body).not.toContain('| Confidence');
    const { body } = sanitiseAuthorFacingBody('I hold this at a confidence of 0.82 for now.');
    expect(scanMachineTokens(body)).toHaveLength(0);
    expect(body).toContain('confidence');
  });

  it('neutralises a banned marketing term rather than shipping it', () => {
    expect(sanitiseAuthorFacingBody('This is a cutting-edge, groundbreaking contribution.').body).not.toMatch(/cutting-edge|groundbreaking/i);
  });

  it('does not corrupt a statistical symbol after a stripped connective', () => {
    const { body } = sanitiseAuthorFacingBody('The result held. Notably, p values were low.');
    expect(body).toContain('p values');
  });

  it('strips a connective opening a plain prose line, which previously cost a fix cycle', () => {
    const { body, removed } = sanitiseAuthorFacingBody('Furthermore, the sampling frame is not reported.');
    expect(body).toBe('The sampling frame is not reported.');
    expect(removed).toContain('furthermore');
  });

  it('never rewrites a connective inside a bold label, because the evidence map must still match it', () => {
    const label = '**Moreover, the frame is unreported.**';
    expect(sanitiseAuthorFacingBody(label).body).toBe(label);
  });
});

describe('prose punctuation scrub', () => {
  it('replaces em dashes and curly quotes, which knowledge/04 bans absolutely', () => {
    expect(scrubProsePunctuation('The estimate — a large one — is unreported.')).toBe('The estimate, a large one, is unreported.');
    expect(scrubProsePunctuation('word—word')).toBe('word, word');
    expect(scrubProsePunctuation('“the claim” and ‘the design’')).toBe('"the claim" and \'the design\'');
  });

  it('leaves en dashes alone, because they carry id and page ranges', () => {
    const ranges = 'See REV-RPX-0068–REV-RPX-0071 and pp. 10–15.';
    expect(scrubProsePunctuation(ranges)).toBe(ranges);
  });

  it('runs as part of the author-facing scrub so no em dash can reach the reader', () => {
    expect(sanitiseAuthorFacingBody('The design — cross-sectional — cannot support this.').body).not.toContain('—');
  });
});

describe('narrativeWordCount', () => {
  it('counts the narrative only, excluding the rubric table and the references', () => {
    const body = [
      'One two three four five.',
      '| criterion | score |',
      '| --- | --- |',
      '| Novelty | 3 |',
      '# References',
      'Riketta, M. (2008). The causal relation between job attitudes and performance.',
    ].join('\n');
    expect(narrativeWordCount(body)).toBe(5);
  });

  it('counts the whole body when no references section is present', () => {
    expect(narrativeWordCount('One two three four five six.')).toBe(6);
  });
});

describe('humanizePairFailures', () => {
  const body = 'Table 2 reports a mean of 6.8 on a five-point scale, which cannot occur.';

  it('accepts a pair whose before is gone and whose after is in the shipped body', () => {
    expect(humanizePairFailures(body, [{ before: 'It is worth noting that the mean seems off.', after: 'Table 2 reports a mean of 6.8' }])).toEqual([]);
  });

  it('rejects the placeholder pair the writer could previously self-attest with', () => {
    const failures = humanizePairFailures(body, [{ before: 'zzz', after: 'qqq' }]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('illustration rather than evidence');
  });

  it('catches a before that still survives in the body, which means the tell was never removed', () => {
    const failures = humanizePairFailures(body, [{ before: 'which cannot occur', after: 'Table 2 reports a mean' }]);
    expect(failures.some((failure) => failure.includes('never removed'))).toBe(true);
  });

  it('matches through markdown emphasis and curly punctuation rather than failing on formatting', () => {
    const emphasised = 'The **mean** of 6.8 “cannot” occur.';
    expect(humanizePairFailures(emphasised, [{ before: 'nowhere near this text', after: 'The mean of 6.8 "cannot" occur.' }])).toEqual([]);
  });
});

describe('shipped-report band and humanize gates', () => {
  function shipped(overrides: Record<string, unknown>) {
    return {
      ...base(),
      authorFacingBody: 'The manuscript reports a concern.',
      authorFacingCitedIds: [],
      privateNotesBody: 'Editorial note.',
      privateNotesReferencedIds: [],
      ...overrides,
    };
  }

  it('flags a narrative outside the band and names the count', () => {
    const result = validateGrounding(shipped({ narrativeBand: { min: 4000, max: 6000 } }));
    expect(result.ok).toBe(false);
    expect(result.kinds).toContain('word-band');
    expect(result.failures.join(' ')).toContain('outside the 4000 to 6000 band');
  });

  it('passes a narrative inside the band', () => {
    const body = Array.from({ length: 4200 }, () => 'word').join(' ');
    const result = validateGrounding(shipped({ authorFacingBody: body, narrativeBand: { min: 4000, max: 6000 } }));
    expect(result.kinds).not.toContain('word-band');
  });

  it('skips both checks when the caller does not ask for them, so mode A is untouched', () => {
    const result = validateGrounding(shipped({}));
    expect(result.kinds).not.toContain('word-band');
    expect(result.kinds).not.toContain('humanize-unproven');
  });

  it('flags unproven humanize pairs', () => {
    const result = validateGrounding(shipped({ humanizePairs: [{ before: 'a', after: 'not in the body at all' }] }));
    expect(result.ok).toBe(false);
    expect(result.kinds).toContain('humanize-unproven');
  });

  it('never halts a complete review over a cosmetic defect: neither kind forces a halt', () => {
    expect(groundingKindsForceHalt(['word-band'])).toBe(false);
    expect(groundingKindsForceHalt(['humanize-unproven'])).toBe(false);
    expect(groundingKindsForceHalt(['editor-only-leak'])).toBe(true);
  });
});
