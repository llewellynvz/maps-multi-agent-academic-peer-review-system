import { describe, expect, it } from 'vitest';
import { labelAppearsInBody } from '../grounding';
import { repairEvidenceLabels } from '../phase7';

const body = [
  '# 4. Developmental feedback',
  '## 4B. By-section review',
  '### Organising spine: Psychology OF and FOR AI systems',
  'Prose about the organising spine and what to strengthen.',
  '### Deploying, Monitoring, and Retiring',
  'Prose about the deployment stages.',
  '### Structural upgrades',
  'Prose about the structural upgrades needed.',
].join('\n');

function envelope(
  evidenceMap: Array<{ section: string; label: string; anchor: string; findingIds: string[] }>,
): Parameters<typeof repairEvidenceLabels>[0] {
  return { bodyMarkdown: body, evidenceMap } as unknown as Parameters<typeof repairEvidenceLabels>[0];
}

describe('repairEvidenceLabels binds abbreviated or expanded section names', () => {
  it('binds a section name that is a prefix of the heading', () => {
    const repaired = repairEvidenceLabels(
      envelope([
        { section: '4B Organising spine', label: 'Strengthen the machine psychology relationship.', anchor: 'x', findingIds: ['REV-THEO-0001'] },
      ]),
    );
    expect(labelAppearsInBody(body, repaired[0]!.label)).toBe(true);
  });

  it('binds when the heading is shorter than the section name', () => {
    const repaired = repairEvidenceLabels(
      envelope([
        { section: '4B Structural upgrades required', label: 'Structural upgrades required', anchor: 'x', findingIds: ['REV-THEO-0002'] },
      ]),
    );
    expect(labelAppearsInBody(body, repaired[0]!.label)).toBe(true);
  });

  it('binds despite a dropped connective word', () => {
    const repaired = repairEvidenceLabels(
      envelope([
        { section: '4B Deploying, Monitoring, Retiring', label: 'Concrete practice scenarios and triage criteria.', anchor: 'x', findingIds: ['REV-THEO-0003'] },
      ]),
    );
    expect(labelAppearsInBody(body, repaired[0]!.label)).toBe(true);
  });

  it('leaves a label that already appears in the body untouched', () => {
    const repaired = repairEvidenceLabels(
      envelope([
        { section: '4B Structural upgrades', label: 'Structural upgrades', anchor: 'x', findingIds: ['REV-THEO-0004'] },
      ]),
    );
    expect(repaired[0]!.label).toBe('Structural upgrades');
  });

  it('refuses to bind when the section tokens match more than one heading', () => {
    const ambiguousBody = [
      '# 4. Developmental feedback',
      '### Psychology OF and FOR AI systems',
      'Prose about OF and FOR.',
      '### Psychology OF, FOR, and BY AI systems',
      'Prose about OF, FOR, and BY.',
    ].join('\n');
    const repaired = repairEvidenceLabels({
      bodyMarkdown: ambiguousBody,
      evidenceMap: [
        { section: '4B Psychology systems', label: 'A stray improvement phrase not in the body.', anchor: 'x', findingIds: ['REV-THEO-0005'] },
      ],
    } as unknown as Parameters<typeof repairEvidenceLabels>[0]);
    expect(repaired[0]!.label).toBe('A stray improvement phrase not in the body.');
    expect(labelAppearsInBody(ambiguousBody, repaired[0]!.label)).toBe(false);
  });

  it('refuses to bind a section that only contains a shorter heading, surfacing the gap', () => {
    const maskBody = [
      '# 4. Developmental feedback',
      '### Structural upgrades',
      'Prose about structural upgrades only.',
      '### Deployment and monitoring guidance',
      'Prose about deployment guidance.',
    ].join('\n');
    const repaired = repairEvidenceLabels({
      bodyMarkdown: maskBody,
      evidenceMap: [
        { section: '4B Structural upgrades to deployment', label: 'A deployment-intent phrase not in the body.', anchor: 'x', findingIds: ['REV-THEO-0006'] },
      ],
    } as unknown as Parameters<typeof repairEvidenceLabels>[0]);
    expect(repaired[0]!.label).toBe('A deployment-intent phrase not in the body.');
    expect(labelAppearsInBody(maskBody, repaired[0]!.label)).toBe(false);
  });
});
