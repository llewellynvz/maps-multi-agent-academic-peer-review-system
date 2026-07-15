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
  JournalScopeScorerOutput,
  ManuscriptSanitizerOutput,
  ManuscriptStructure,
  PhaseCriticOutput,
  QualityMetricsEngineOutput,
  ReviewCalibratorOutput,
  ReviewFinalCriticOutput,
  ReviewMetaReviewerOutput,
  ScoutPlan,
  ShippedReportEnvelope,
  SpecialistReviewerOutput,
  SwarmEvaluation,
  SwarmReportCritique,
} from '@mara/shared';
import {
  assemble,
  CONSTITUTION_FRAME,
  FULL_ROSTER,
  PHASE_0_6_ROSTER,
  PHASE_7_8_ROSTER,
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
      expect(Array.isArray(value.keyPapers)).toBe(true);
      expect(Array.isArray(value.methodNorms)).toBe(true);
    },
  },
  {
    label: 'field-context-scout plan mode returns vocabulary and three to eight topic queries',
    agent: 'field-context-scout',
    mode: 'plan',
    file: 'field-context-scout-plan.json',
    assert: (output) => {
      const value = output as ScoutPlan;
      expect(value.mode).toBe('plan');
      expect(value.queryVocabulary.length).toBeGreaterThan(0);
      expect(value.topicQueries.length).toBeGreaterThanOrEqual(3);
      expect(value.topicQueries.length).toBeLessThanOrEqual(8);
      expect(value.topicQueries.every((entry) => entry.query.length >= 3 && entry.purpose.length >= 1)).toBe(true);
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
  {
    label: 'meta-reviewer scores 15 grounded criteria and a down-only recommendation',
    agent: 'review-meta-reviewer',
    file: 'review-meta-reviewer.json',
    assert: (output) => {
      const value = output as ReviewMetaReviewerOutput;
      expect(value.rubric).toHaveLength(15);
      expect(value.rubric.every((row) => row.supportingIds.length >= 1)).toBe(true);
      expect(value.recommendation).toBe('major_revision');
      expect(value.decisionHinges.some((hinge) => hinge.findingId === 'REV-STAT-0001')).toBe(true);
    },
  },
  {
    label: 'report writer mode B ships the seven-part report id-free with a grounding evidence map',
    agent: 'review-report-writer',
    mode: 'B',
    file: 'review-report-writer-B.json',
    assert: (output) => {
      const value = output as ShippedReportEnvelope;
      expect(value.editorOnlyLeak).toBe(false);
      expect(value.rubricTable).toHaveLength(15);
      expect(value.citedFindingIds).toContain('REV-STAT-0001');
      expect(value.bodyMarkdown).not.toMatch(/REV-[A-Z]{3,4}-\d{4}/);
      expect(value.evidenceMap.length).toBeGreaterThan(0);
      const union = new Set(value.evidenceMap.flatMap((entry) => entry.findingIds));
      expect([...union].sort()).toEqual([...value.citedFindingIds].sort());
      for (const entry of value.evidenceMap) {
        expect(value.bodyMarkdown).toContain(`**${entry.label}`);
      }
    },
  },
  {
    label: 'swarm mode B critiques the report against the ledger',
    agent: 'swarm',
    mode: 'B',
    file: 'swarm-B.json',
    assert: (output) => {
      const value = output as SwarmReportCritique;
      expect(value.critique.length).toBeGreaterThan(0);
      expect(value.critique.some((item) => item.findingId === 'REV-STAT-0001')).toBe(true);
    },
  },
  {
    label: 'final critic routes a defective finding to revise-specialist with the lens named',
    agent: 'review-final-critic',
    file: 'review-final-critic.json',
    assert: (output) => {
      const value = output as ReviewFinalCriticOutput;
      expect(value.verdict).toBe('revise-specialist');
      expect(value.lens).not.toBeNull();
      expect(value.findingIdToSupersede).toBe('REV-STAT-0001');
    },
  },
  {
    label: 'phase critic flags a material coverage gap and routes a re-dispatch',
    agent: 'phase-critic',
    file: 'phase-critic.json',
    assert: (output) => {
      const value = output as PhaseCriticOutput;
      expect(value.verdict).toBe('redispatch');
      expect(value.defects.some((defect) => defect.severity === 'material' && defect.redispatchTarget !== null)).toBe(
        true,
      );
      expect(value.strongestGap.length).toBeGreaterThan(0);
    },
  },
  {
    label: 'quality-metrics engine reports the fixed weights and a composite in range',
    agent: 'quality-metrics-engine',
    file: 'quality-metrics-engine.json',
    assert: (output) => {
      const value = output as QualityMetricsEngineOutput;
      const weightSum =
        value.weights.evidenceGroundingRate +
        value.weights.actionabilityIndex +
        value.weights.decisionStability +
        value.weights.toneRiskScore +
        value.weights.unsupportedClaimPenalty;
      expect(Math.abs(weightSum - 1)).toBeLessThan(1e-9);
      expect(value.composite).toBeGreaterThanOrEqual(0);
      expect(value.composite).toBeLessThanOrEqual(1);
    },
  },
  {
    label: 'journal-scope scorer uses legitimate factors only',
    agent: 'journal-scope-scorer',
    file: 'journal-scope-scorer.json',
    assert: (output) => {
      const value = output as JournalScopeScorerOutput;
      const legitimate = new Set([
        'topic-fit',
        'article-type-compatibility',
        'methodological-approach-match',
        'contribution-type-alignment',
      ]);
      expect(value.factorsUsed.every((factor) => legitimate.has(factor))).toBe(true);
      expect(value.noveltyPenaltyApplied).toBe(false);
    },
  },
  {
    label: 'review calibrator falls back to cross-journal below the ten-review threshold',
    agent: 'review-calibrator',
    file: 'review-calibrator.json',
    assert: (output) => {
      const value = output as ReviewCalibratorOutput;
      expect(value.mode).toBe('cross-journal-fallback');
      expect(value.journalSpecificThresholdMet).toBe(false);
      expect(value.completedReviewsForJournal).toBeLessThan(10);
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

  it('binds a golden fixture to every phase 7-8 roster agent', () => {
    const bound = new Set(bindings.map((binding) => binding.agent));
    for (const agent of PHASE_7_8_ROSTER) {
      expect(bound.has(agent)).toBe(true);
    }
  });

  it('binds a golden fixture to every agent in the full roster', () => {
    const bound = new Set(bindings.map((binding) => binding.agent));
    for (const agent of FULL_ROSTER) {
      expect(bound.has(agent)).toBe(true);
    }
  });

  it('binds a golden fixture to every mode the phase 7-8 engine dispatches', () => {
    const boundModes = new Set(bindings.map((binding) => `${binding.agent}:${binding.mode ?? 'default'}`));
    const engineConsumed = [
      'review-meta-reviewer:default',
      'review-report-writer:B',
      'swarm:B',
      'review-final-critic:default',
      'quality-metrics-engine:default',
      'journal-scope-scorer:default',
      'review-calibrator:default',
    ];
    for (const pair of engineConsumed) {
      expect(boundModes.has(pair)).toBe(true);
    }
  });

  it('binds a golden fixture to every mode the phase 1-6 engine dispatches', () => {
    const boundModes = new Set(bindings.map((binding) => `${binding.agent}:${binding.mode ?? 'default'}`));
    const engineConsumed = [
      'manuscript-analyst:A',
      'manuscript-analyst:B',
      'field-context-scout:default',
      'field-context-scout:plan',
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
