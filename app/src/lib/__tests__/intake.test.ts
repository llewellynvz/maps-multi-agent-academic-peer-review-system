import { describe, expect, it } from 'vitest';
import type { Detected, EvidenceData, Question, QuestionsResponse } from '@/lib/api';
import {
  alignmentSentence,
  buildAnswersPayload,
  detectedTitle,
  hasPriorStressTest,
  humanizeOption,
  parseQualitySentence,
  resolveAnswer,
  resolveIntake,
} from '@/lib/intake';

const detected: Detected = {
  field: 'Wellbeing science',
  studyDesign: 'cross-sectional survey',
  manuscriptType: 'empirical',
  language: 'en',
  wordCount: 7200,
  parseQuality: 'good',
};

function question(partial: Partial<Question> & { id: string }): Question {
  return { kind: 'choice', prompt: partial.id, default: '', ...partial };
}

function response(questions: Question[]): QuestionsResponse {
  return { detected, questions };
}

const TODAY: Question[] = [
  question({ id: 'preset', kind: 'choice', options: ['fast', 'balanced', 'thorough'], detectedValue: 'balanced', default: 'balanced' }),
  question({ id: 'field-confirm', kind: 'confirm', detectedValue: 'Wellbeing science', default: 'Wellbeing science' }),
  question({ id: 'title', kind: 'text', detectedValue: 'On flourishing', default: '' }),
  question({ id: 'journal', kind: 'text', default: '' }),
];

const ENRICHED: Question[] = [
  ...TODAY,
  question({ id: 'review-title', kind: 'text', detectedValue: 'On flourishing', default: '' }),
  question({ id: 'paper-type', kind: 'choice', options: ['empirical', 'theoretical', 'case-study'], detectedValue: 'empirical', default: 'empirical' }),
  question({ id: 'reference-audit', kind: 'choice', options: ['standard', 'forensic'], detectedValue: 'standard', default: 'standard' }),
  question({ id: 'claim-check', kind: 'choice', options: ['no', 'yes'], detectedValue: 'no', default: 'no' }),
  question({ id: 'ai-detection', kind: 'choice', options: ['yes', 'no'], detectedValue: 'yes', default: 'yes' }),
  question({ id: 'user-prior', kind: 'choice', options: ['none', 'accept', 'minor-revision'], detectedValue: 'none', default: 'none' }),
];

describe('resolveIntake', () => {
  it('keeps the legacy payload rendering as three sections with no new controls', () => {
    const layout = resolveIntake(response(TODAY));
    expect(layout.metadataQuestions.map((q) => q.id)).toEqual(['field-confirm', 'title']);
    expect(layout.preset?.id).toBe('preset');
    expect(layout.journal?.id).toBe('journal');
    expect(layout.reviewTitle).toBeNull();
    expect(layout.paperType).toBeNull();
    expect(layout.referenceAudit).toBeNull();
    expect(layout.claimCheck).toBeNull();
    expect(layout.aiDetection).toBeNull();
    expect(layout.userPrior).toBeNull();
    expect(layout.showVerification).toBe(false);
    expect(layout.showAssessment).toBe(false);
  });

  it('surfaces every new control on the enriched payload', () => {
    const layout = resolveIntake(response(ENRICHED));
    expect(layout.metadataQuestions.map((q) => q.id)).toEqual(['field-confirm', 'title']);
    expect(layout.reviewTitle?.id).toBe('review-title');
    expect(layout.paperType?.id).toBe('paper-type');
    expect(layout.referenceAudit?.id).toBe('reference-audit');
    expect(layout.claimCheck?.id).toBe('claim-check');
    expect(layout.aiDetection?.id).toBe('ai-detection');
    expect(layout.userPrior?.id).toBe('user-prior');
    expect(layout.showVerification).toBe(true);
    expect(layout.showAssessment).toBe(true);
  });

  it('treats an unknown question id as a generic metadata correction', () => {
    const layout = resolveIntake(response([question({ id: 'sampleSize', kind: 'text', default: '' })]));
    expect(layout.metadataQuestions.map((q) => q.id)).toEqual(['sampleSize']);
    expect(layout.showVerification).toBe(false);
  });

  it('shows verification when only one of its checks is present', () => {
    const layout = resolveIntake(response([
      question({ id: 'ai-detection', kind: 'choice', options: ['yes', 'no'], default: 'yes' }),
    ]));
    expect(layout.showVerification).toBe(true);
    expect(layout.referenceAudit).toBeNull();
  });
});

describe('buildAnswersPayload', () => {
  const untouched = { answers: {}, preset: 'balanced', journal: '', focus: [], notes: '' };

  it('posts the same shape as before on the legacy payload', () => {
    expect(buildAnswersPayload(TODAY, untouched)).toEqual([
      { questionId: 'preset', value: 'balanced' },
      { questionId: 'journal', value: 'None' },
      { questionId: 'feedback_focus', value: [] },
    ]);
  });

  it('only includes an edited legacy metadata answer, plus journal and notes when given', () => {
    const payload = buildAnswersPayload(TODAY, {
      answers: { 'field-confirm': 'Organisational psychology' },
      preset: 'thorough',
      journal: 'PLOS ONE',
      focus: ['Methods'],
      notes: 'Check the mediation model.',
    });
    expect(payload).toEqual([
      { questionId: 'preset', value: 'thorough' },
      { questionId: 'field-confirm', value: 'Organisational psychology' },
      { questionId: 'journal', value: 'PLOS ONE' },
      { questionId: 'feedback_focus', value: ['Methods'] },
      { questionId: 'notes', value: 'Check the mediation model.' },
    ]);
  });

  it('records the detected or default value for every new id even when untouched', () => {
    const payload = buildAnswersPayload(ENRICHED, untouched);
    const byId = new Map(payload.map((entry) => [entry.questionId, entry.value]));
    expect(byId.get('ai-detection')).toBe('yes');
    expect(byId.get('reference-audit')).toBe('standard');
    expect(byId.get('claim-check')).toBe('no');
    expect(byId.get('user-prior')).toBe('none');
    expect(byId.get('paper-type')).toBe('empirical');
    expect(byId.get('review-title')).toBe('On flourishing');
  });

  it('posts the toggled verification values over their defaults', () => {
    const payload = buildAnswersPayload(ENRICHED, {
      ...untouched,
      answers: { 'reference-audit': 'forensic', 'ai-detection': 'no', 'claim-check': 'yes' },
    });
    const byId = new Map(payload.map((entry) => [entry.questionId, entry.value]));
    expect(byId.get('reference-audit')).toBe('forensic');
    expect(byId.get('ai-detection')).toBe('no');
    expect(byId.get('claim-check')).toBe('yes');
  });

  it('drops a new id whose resolved value is empty', () => {
    const payload = buildAnswersPayload(
      [question({ id: 'review-title', kind: 'text', default: '' })],
      untouched,
    );
    expect(payload.some((entry) => entry.questionId === 'review-title')).toBe(false);
  });
});

describe('resolveAnswer', () => {
  it('resolves the answer, then the detected value, then the default', () => {
    const q = question({ id: 'reference-audit', detectedValue: 'forensic', default: 'standard' });
    expect(resolveAnswer(q, { 'reference-audit': 'standard' })).toBe('standard');
    expect(resolveAnswer(q, {})).toBe('forensic');
    expect(resolveAnswer(question({ id: 'reference-audit', default: 'standard' }), {})).toBe('standard');
  });
});

describe('humanizeOption', () => {
  it('turns hyphenated option values into readable labels', () => {
    expect(humanizeOption('empirical')).toBe('Empirical');
    expect(humanizeOption('case-study')).toBe('Case study');
    expect(humanizeOption('perspective-or-opinion')).toBe('Perspective or opinion');
    expect(humanizeOption('reject-and-resubmit')).toBe('Reject and resubmit');
  });

  it('returns the original value when there is nothing to humanize', () => {
    expect(humanizeOption('')).toBe('');
  });
});

describe('detectedTitle', () => {
  it('prefers the reviewTitle detected value, then the title question', () => {
    expect(detectedTitle(response(ENRICHED))).toBe('On flourishing');
    expect(detectedTitle(response([question({ id: 'title', kind: 'text', detectedValue: 'Only title', default: '' })]))).toBe('Only title');
  });

  it('returns null when no title is detectable', () => {
    expect(detectedTitle(response([question({ id: 'preset', kind: 'choice', default: 'balanced' })]))).toBeNull();
  });
});

describe('parseQualitySentence', () => {
  it('explains each parse quality in one plain sentence', () => {
    expect(parseQualitySentence('good')).toMatch(/read cleanly/);
    expect(parseQualitySentence('degraded')).toMatch(/did not read cleanly/);
  });
});

describe('alignmentSentence', () => {
  it('maps each alignment to readable copy and tolerates spacing and case', () => {
    expect(alignmentSentence('supported')).toMatch(/supports/);
    expect(alignmentSentence('partially-supported')).toMatch(/partly supports/);
    expect(alignmentSentence('partially supported')).toMatch(/partly supports/);
    expect(alignmentSentence('Contradicted')).toMatch(/runs against/);
    expect(alignmentSentence('unknown-label')).toMatch(/weighed against/);
  });
});

describe('hasPriorStressTest', () => {
  const base: EvidenceData = { evidenceMap: [], findings: [] };

  it('is false for legacy payloads without the field', () => {
    expect(hasPriorStressTest(base)).toBe(false);
    expect(hasPriorStressTest(null)).toBe(false);
    expect(hasPriorStressTest(undefined)).toBe(false);
    expect(hasPriorStressTest({ ...base, priorStressTest: null })).toBe(false);
  });

  it('is true only when a non-empty prior is present', () => {
    expect(
      hasPriorStressTest({
        ...base,
        priorStressTest: { prior: 'minor-revision', caseFor: 'a', caseAgainst: 'b', alignment: 'supported', hingeFindingIds: [] },
      }),
    ).toBe(true);
    expect(
      hasPriorStressTest({
        ...base,
        priorStressTest: { prior: '', caseFor: 'a', caseAgainst: 'b', alignment: 'supported', hingeFindingIds: [] },
      }),
    ).toBe(false);
  });

  it('rejects a partial object missing the fields the panel dereferences', () => {
    const partial = { prior: 'minor-revision' } as EvidenceData['priorStressTest'];
    expect(hasPriorStressTest({ ...base, priorStressTest: partial })).toBe(false);
    const noHinges = {
      prior: 'accept',
      caseFor: 'a',
      caseAgainst: 'b',
      alignment: 'supported',
    } as EvidenceData['priorStressTest'];
    expect(hasPriorStressTest({ ...base, priorStressTest: noHinges })).toBe(false);
  });
});
