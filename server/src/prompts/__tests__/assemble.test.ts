import { describe, expect, it } from 'vitest';
import { assemble, buildStaticFrame, CONSTITUTION_FRAME, readManifest, readPrompt } from '../index';
import { readKnowledgeModules } from '../knowledge';

describe('prompt assembler', () => {
  it('produces a byte-identical system frame for the same agent across dispatches', () => {
    const first = assemble('specialist-reviewer', {
      mode: 'first-pass',
      lens: 'REV-STAT',
      parseQuality: 'good',
      manuscriptExcerpt: 'Section 1. Methods excerpt A.',
    });
    const second = assemble('specialist-reviewer', {
      mode: 'challenge',
      lens: 'REV-STAT',
      parseQuality: 'degraded',
      manuscriptExcerpt: 'Section 2. Different excerpt B.',
      artefacts: [{ label: 'Other lens findings', content: 'REV-NOV-0001 ...' }],
    });
    expect(second.system).toBe(first.system);
    expect(second.user).not.toBe(first.user);
  });

  it('places only dynamic content in the user part, never in the system frame', () => {
    const built = assemble('manuscript-analyst', {
      mode: 'A',
      manuscriptExcerpt: 'UNIQUE_MANUSCRIPT_TOKEN_XYZ',
      artefacts: [{ label: 'Prior artefact', content: 'PRIOR_ARTEFACT_TOKEN_QRS' }],
    });
    expect(built.system).not.toContain('UNIQUE_MANUSCRIPT_TOKEN_XYZ');
    expect(built.system).not.toContain('PRIOR_ARTEFACT_TOKEN_QRS');
    expect(built.user).toContain('UNIQUE_MANUSCRIPT_TOKEN_XYZ');
    expect(built.user).toContain('PRIOR_ARTEFACT_TOKEN_QRS');
  });

  it('injects manuscripts.parse_quality into the dynamic context so degraded parses are visible', () => {
    const good = assemble('field-context-scout', { parseQuality: 'good' });
    const degraded = assemble('field-context-scout', { parseQuality: 'degraded' });
    expect(good.user).toContain('parse quality "good"');
    expect(degraded.user).toContain('parse quality "degraded"');
    expect(degraded.user.toLowerCase()).toContain('degraded');
  });

  it('assembles the static frame as constitution then manifest knowledge modules verbatim then prompt.md, in order', () => {
    const frame = buildStaticFrame('citation-auditor');
    const manifest = readManifest('citation-auditor');
    const modules = readKnowledgeModules(manifest.knowledge);
    const prompt = readPrompt('citation-auditor');
    const expected = [CONSTITUTION_FRAME, ...modules, prompt].join('\n\n');
    expect(frame).toBe(expected);

    const firstModule = modules[0] ?? '';
    expect(firstModule.length).toBeGreaterThan(0);
    const constitutionIndex = frame.indexOf(CONSTITUTION_FRAME);
    const firstModuleIndex = frame.indexOf(firstModule);
    const promptIndex = frame.indexOf(prompt);
    expect(constitutionIndex).toBe(0);
    expect(firstModuleIndex).toBeGreaterThan(constitutionIndex);
    expect(promptIndex).toBeGreaterThan(firstModuleIndex);
  });

  it('includes every manifest-listed knowledge module verbatim and none that are unlisted', () => {
    const frame = buildStaticFrame('manuscript-sanitizer');
    const manifest = readManifest('manuscript-sanitizer');
    for (const moduleFile of manifest.knowledge) {
      const moduleBody = readKnowledgeModules([moduleFile])[0] ?? '';
      expect(moduleBody.length).toBeGreaterThan(0);
      expect(frame).toContain(moduleBody);
    }
    const decisionModule = readKnowledgeModules(['03_REVIEW_DECISION.md'])[0] ?? '';
    expect(manifest.knowledge).not.toContain('03_REVIEW_DECISION.md');
    expect(frame).not.toContain(decisionModule);
  });

  it('shares a prefix longer than 1024 tokens so hosted prompt caching hits', () => {
    const frame = buildStaticFrame('specialist-reviewer');
    expect(frame.length / 4).toBeGreaterThan(1024);
  });
});
