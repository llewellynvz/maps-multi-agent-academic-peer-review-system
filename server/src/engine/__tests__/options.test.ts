import { describe, expect, it } from 'vitest';
import { mapManuscriptTypeToPaperType, readIntakeOptions } from '../options';

function withAnswers(answers: Record<string, unknown>): Record<string, unknown> {
  return { preset: 'balanced', answers };
}

describe('readIntakeOptions', () => {
  it('reads every field from a fully specified intake', () => {
    const intake = readIntakeOptions(
      withAnswers({
        reviewTitle: 'My review of the wellbeing trial',
        paperType: 'methodological',
        referenceAudit: 'forensic',
        claimCheck: 'yes',
        aiDetection: 'no',
        userPrior: 'major-revision',
      }),
    );
    expect(intake).toEqual({
      reviewTitle: 'My review of the wellbeing trial',
      paperType: 'methodological',
      referenceAudit: 'forensic',
      claimCheck: true,
      aiDetection: false,
      userPrior: 'major-revision',
    });
  });

  it('applies defaults when answers are absent', () => {
    expect(readIntakeOptions({})).toEqual({
      reviewTitle: null,
      paperType: null,
      referenceAudit: 'standard',
      claimCheck: false,
      aiDetection: true,
      userPrior: null,
    });
  });

  it('falls back tolerantly on junk input', () => {
    const intake = readIntakeOptions(
      withAnswers({
        reviewTitle: '   ',
        paperType: 'not-a-real-type',
        referenceAudit: 'FORENSIC',
        claimCheck: 'maybe',
        aiDetection: 'yeah',
        userPrior: 'none',
      }),
    );
    expect(intake.reviewTitle).toBeNull();
    expect(intake.paperType).toBeNull();
    expect(intake.referenceAudit).toBe('standard');
    expect(intake.claimCheck).toBe(false);
    expect(intake.aiDetection).toBe(true);
    expect(intake.userPrior).toBeNull();
  });

  it('treats a missing answers object as all defaults', () => {
    expect(readIntakeOptions({ answers: null })).toMatchObject({ aiDetection: true, referenceAudit: 'standard' });
    expect(readIntakeOptions({ answers: 'oops' })).toMatchObject({ claimCheck: false, userPrior: null });
  });

  it('maps aiDetection only off when explicitly no', () => {
    expect(readIntakeOptions(withAnswers({ aiDetection: 'yes' })).aiDetection).toBe(true);
    expect(readIntakeOptions(withAnswers({ aiDetection: 'no' })).aiDetection).toBe(false);
    expect(readIntakeOptions(withAnswers({})).aiDetection).toBe(true);
  });

  it('trims a review title and rejects an empty prior', () => {
    expect(readIntakeOptions(withAnswers({ reviewTitle: '  Trimmed  ' })).reviewTitle).toBe('Trimmed');
    expect(readIntakeOptions(withAnswers({ userPrior: '' })).userPrior).toBeNull();
    expect(readIntakeOptions(withAnswers({ userPrior: 'reject' })).userPrior).toBe('reject');
  });
});

describe('mapManuscriptTypeToPaperType', () => {
  it('maps provisional manuscript types onto the paper-type taxonomy', () => {
    expect(mapManuscriptTypeToPaperType('Empirical study')).toBe('empirical');
    expect(mapManuscriptTypeToPaperType('theoretical contribution')).toBe('theoretical');
    expect(mapManuscriptTypeToPaperType('systematic review')).toBe('review');
    expect(mapManuscriptTypeToPaperType('meta-analysis')).toBe('review');
    expect(mapManuscriptTypeToPaperType('opinion piece')).toBe('perspective-or-opinion');
    expect(mapManuscriptTypeToPaperType('commentary')).toBe('perspective-or-opinion');
    expect(mapManuscriptTypeToPaperType('methods paper')).toBe('methodological');
    expect(mapManuscriptTypeToPaperType('case study')).toBe('case-study');
  });

  it('falls back to empirical on an unknown type', () => {
    expect(mapManuscriptTypeToPaperType('unknown')).toBe('empirical');
    expect(mapManuscriptTypeToPaperType('')).toBe('empirical');
  });
});
