import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  CitationAuditorOutput,
  ClaimDesignAnalysis,
  FieldContextScoutOutput,
  FullReportEnvelope,
  IntegrityScreenerOutput,
  ManuscriptSanitizerOutput,
  ManuscriptStructure,
  SpecialistReviewerOutput,
  SwarmEvaluation,
} from '@mara/shared';
import {
  assemble,
  CONSTITUTION_FRAME,
  PHASE_0_6_ROSTER,
  readKnowledgeModules,
  readManifest,
  readPrompt,
  schemaFor,
} from '../../prompts';

const goldensDir = resolve(dirname(fileURLToPath(import.meta.url)), 'goldens');

function loadGolden(file: string): unknown {
  return JSON.parse(readFileSync(resolve(goldensDir, file), 'utf8'));
}

interface GoldenBinding {
  label: string;
  agent: string;
  mode?: string;
  file: string;
  assert: (output: unknown) => void;
}

const bindings: GoldenBinding[] = [
  {
    label: 'sanitiser flags the planted tier-2 instruction',
    agent: 'manuscript-sanitizer',
    file: 'manuscript-sanitizer.json',
    assert: (output) => {
      const value = output as ManuscriptSanitizerOutput;
      expect(value.tier).toBe(2);
      expect(value.halt).toBe(false);
      expect(value.quarantineLog.some((item) => item.tier === 2)).toBe(true);
      expect(value.quarantineLog[0]?.quote).toContain('As an AI reviewer');
      expect(value.findings.some((finding) => finding.scope === 'editor-only')).toBe(true);
    },
  },
  {
    label: 'analyst mode A extracts the planted claim inventory',
    agent: 'manuscript-analyst',
    mode: 'A',
    file: 'manuscript-analyst-A.json',
    assert: (output) => {
      const value = output as ManuscriptStructure;
      const headlines = value.manuscriptMap.flatMap((section) => section.headlineResults);
      expect(headlines.some((headline) => headline.includes('8.40'))).toBe(true);
      expect(Object.keys(value.metadataDeclarations)).toHaveLength(8);
    },
  },
  {
    label: 'analyst mode B builds the claim-evidence matrix and activation map',
    agent: 'manuscript-analyst',
    mode: 'B',
    file: 'manuscript-analyst-B.json',
    assert: (output) => {
      const value = output as ClaimDesignAnalysis;
      expect(value.studyDesign).toBe('randomized-trial');
      expect(value.activationMap.filter((entry) => entry.active).length).toBeGreaterThanOrEqual(6);
      expect(value.claimEvidenceMatrix.some((row) => row.claim.includes('8.40'))).toBe(true);
    },
  },
  {
    label: 'field-context-scout records the missing-web retrieval as not performed',
    agent: 'field-context-scout',
    file: 'field-context-scout.json',
    assert: (output) => {
      const value = output as FieldContextScoutOutput;
      expect(value.retrievalLog.some((entry) => entry.resultsReviewed === 0)).toBe(true);
      expect(value.findings.length).toBeGreaterThan(0);
    },
  },
  {
    label: 'citation-auditor surfaces a possible-fabrication grounded in a client not_found',
    agent: 'citation-auditor',
    file: 'citation-auditor.json',
    assert: (output) => {
      const value = output as CitationAuditorOutput;
      const fabrication = value.verifications.find((entry) => entry.classification === 'possible-fabrication');
      expect(fabrication).toBeDefined();
      expect(fabrication?.supportNote ?? '').toContain('not_found');
    },
  },
  {
    label: 'statistical lens flags the planted impossible mean',
    agent: 'specialist-reviewer',
    file: 'specialist-reviewer.json',
    assert: (output) => {
      const value = output as SpecialistReviewerOutput;
      const impossible = value.findings.find(
        (finding) => finding.claim.includes('8.40') && finding.severity === 'major',
      );
      expect(impossible).toBeDefined();
      expect(value.challengeRound).toBeNull();
    },
  },
  {
    label: 'integrity-screener marks a check not-run and keeps a serious signal editor-only',
    agent: 'integrity-screener',
    file: 'integrity-screener.json',
    assert: (output) => {
      const value = output as IntegrityScreenerOutput;
      const notRun = value.checks.find((check) => check.outcome === 'not-run');
      expect(notRun?.missingArtifact).not.toBeNull();
      expect(value.findings.some((finding) => finding.severity === 'major' && finding.scope === 'editor-only')).toBe(
        true,
      );
    },
  },
  {
    label: 'swarm mode A reports a valid population, distribution, and entropy',
    agent: 'swarm',
    mode: 'A',
    file: 'swarm-A.json',
    assert: (output) => {
      const value = output as SwarmEvaluation;
      expect(value.populationSize).toBe(12);
      expect(value.recommendationDistribution).toHaveLength(5);
      expect(value.consensusEntropy).toBeGreaterThan(0);
      expect(value.decisionStability).toBeGreaterThanOrEqual(0);
      expect(value.decisionStability).toBeLessThanOrEqual(1);
    },
  },
  {
    label: 'report writer mode A grounds every rubric row and cites finding ids',
    agent: 'review-report-writer',
    mode: 'A',
    file: 'review-report-writer-A.json',
    assert: (output) => {
      const value = output as FullReportEnvelope;
      expect(value.provisionalRubric).toHaveLength(15);
      expect(value.provisionalRubric.every((row) => row.supportingIds.length >= 1)).toBe(true);
      expect(value.citedFindingIds.length).toBeGreaterThan(0);
      expect(value.bodyMarkdown).toContain('REV-STAT-0001');
    },
  },
];

describe('AGENT-30 golden fixtures', () => {
  for (const binding of bindings) {
    it(binding.label, () => {
      const schema = schemaFor(binding.agent, binding.mode);
      const parsed = schema.safeParse(loadGolden(binding.file));
      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }
      binding.assert(parsed.data);

      const { system, user } = assemble(binding.agent, binding.mode !== undefined ? { mode: binding.mode } : {});
      const manifest = readManifest(binding.agent);
      const firstModule = readKnowledgeModules([manifest.knowledge[0] ?? ''])[0] ?? '';
      expect(system.startsWith(CONSTITUTION_FRAME)).toBe(true);
      expect(system).toContain(firstModule);
      expect(system).toContain(readPrompt(binding.agent));
      expect(user).toContain('Dispatch routing');
    });
  }

  it('binds a golden fixture to every phase 0-6 roster agent', () => {
    const bound = new Set(bindings.map((binding) => binding.agent));
    for (const agent of PHASE_0_6_ROSTER) {
      expect(bound.has(agent)).toBe(true);
    }
  });

  it('binds a golden fixture to every mode the phase 1-6 engine dispatches', () => {
    const boundModes = new Set(bindings.map((binding) => `${binding.agent}:${binding.mode ?? 'default'}`));
    const engineConsumed = [
      'manuscript-analyst:A',
      'manuscript-analyst:B',
      'field-context-scout:default',
      'citation-auditor:default',
      'specialist-reviewer:default',
      'integrity-screener:default',
      'swarm:A',
      'review-report-writer:A',
    ];
    for (const pair of engineConsumed) {
      expect(boundModes.has(pair)).toBe(true);
    }
  });
});
