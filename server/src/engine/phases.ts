import type {
  ClaimDesignAnalysis,
  CitationAuditorOutput,
  FieldContextScoutOutput,
  Finding,
  FullReportEnvelope,
  IntegrityScreenerOutput,
  ManuscriptStructure,
  SpecialistReviewerOutput,
  SwarmEvaluation,
} from '@mara/shared';
import type { CitationClient } from '../citations';
import type { MaraDatabase } from '../db/client';
import { getCurrentFindings, mergeFindings } from '../ledger';
import { withPhase } from '../tracing';
import type { DispatchRunner } from '../providers';
import { getCheckpoint, insertEvent, updateReview, upsertCheckpoint } from '../workflow/repo';
import { readArtefact, writeArtefact } from './artefacts';
import { computeComposite } from './composite';
import {
  loadEngineContext,
  manuscriptDigest,
  referenceMetadataList,
  referencesForVerification,
} from './context';
import { selectActiveLenses, selectChallengeLenses, swarmProfile } from './lenses';
import { runAgent } from './dispatch-agent';
import { upsertRubricScore } from './rubric';

export interface EngineDeps {
  db: MaraDatabase;
  runDispatch: DispatchRunner;
  citationClient?: CitationClient;
}

function phaseDone(db: MaraDatabase, reviewId: string, phase: string): boolean {
  return getCheckpoint(db, reviewId, phase)?.status === 'completed';
}

function enterPhase(db: MaraDatabase, reviewId: string, phase: string): void {
  updateReview(db, reviewId, { status: 'running', currentPhase: phase });
}

export async function runPhase1(deps: EngineDeps, reviewId: string): Promise<void> {
  const { db } = deps;
  if (phaseDone(db, reviewId, 'phase_1')) {
    return;
  }
  const ctx = loadEngineContext(db, reviewId);
  const digest = manuscriptDigest(ctx.sectionMap);

  await withPhase('phase_1', async () => {
    enterPhase(db, reviewId, 'phase_1');

    const analystA = await runAgent<ManuscriptStructure>(deps, {
      reviewId,
      phase: 'phase_1',
      agent: 'manuscript-analyst',
      mode: 'A',
      artefactName: 'p1-analyst-a',
      assembleInput: {
        mode: 'A',
        parseQuality: ctx.parseQuality,
        manuscriptExcerpt: digest,
        routingNote:
          'Mode A: extract the manuscript map, section inventory, metadata declarations, figure and table inventory, and ambiguity findings. Prefix any findings REV-MAP.',
      },
    });
    mergeFindings(db, {
      reviewId,
      lensPrefix: 'MAP',
      phase: 'phase_1',
      agent: 'manuscript-analyst',
      fragments: analystA.findings,
    });

    const analystB = await runAgent<ClaimDesignAnalysis>(deps, {
      reviewId,
      phase: 'phase_1',
      agent: 'manuscript-analyst',
      mode: 'B',
      artefactName: 'p1-analyst-b',
      assembleInput: {
        mode: 'B',
        parseQuality: ctx.parseQuality,
        manuscriptExcerpt: digest,
        artefacts: [{ label: 'Mode A structured analysis', content: JSON.stringify(analystA) }],
        routingNote:
          'Mode B: build the claim-evidence matrix, classify the study design, route the reporting guideline, and produce the specialist activation map with a one-line rationale per lens. Prefix any findings REV-MAP.',
      },
    });
    mergeFindings(db, {
      reviewId,
      lensPrefix: 'MAP',
      phase: 'phase_1',
      agent: 'manuscript-analyst',
      fragments: analystB.findings,
    });

    insertEvent(db, {
      reviewId,
      kind: 'phase_transition',
      phase: 'phase_1',
      payload: {
        studyDesign: analystB.studyDesign,
        activeLensCount: analystB.activationMap.filter((entry) => entry.active).length,
      },
    });
    upsertCheckpoint(db, {
      reviewId,
      phase: 'phase_1',
      status: 'completed',
      snapshot: { studyDesign: analystB.studyDesign, activationMap: analystB.activationMap },
    });
  });
}

interface ClientVerdict {
  referenceIndex: number;
  title: string;
  status: string;
  source: string | null;
  confidence: number;
  matchedDoi: string | null;
}

function reconcileExistence(
  verification: CitationAuditorOutput['verifications'][number],
  clientVerdicts: ClientVerdict[],
): Record<string, unknown> {
  const verdict = clientVerdicts.find((entry) => entry.referenceIndex === verification.referenceIndex);
  if (verdict === undefined) {
    return { ...verification, clientExistence: 'not-checked', authoritativeExistence: 'llm-judgement-only' };
  }
  let classification = verification.classification;
  if (verdict.status === 'verified' && classification === 'possible-fabrication') {
    classification = 'partially-confirmed';
  }
  if (verdict.status === 'not_found' && classification === 'confirmed') {
    classification = 'unverifiable';
  }
  return {
    ...verification,
    classification,
    clientExistence: verdict.status,
    clientSource: verdict.source,
    authoritativeExistence: verdict.status,
  };
}

export async function runPhase2(deps: EngineDeps, reviewId: string): Promise<void> {
  const { db } = deps;
  if (phaseDone(db, reviewId, 'phase_2')) {
    return;
  }
  const ctx = loadEngineContext(db, reviewId);
  const digest = manuscriptDigest(ctx.sectionMap);
  const analystB = readArtefact<ClaimDesignAnalysis>(reviewId, 'p1-analyst-b');
  const matrixJson = JSON.stringify(analystB.claimEvidenceMatrix);

  await withPhase('phase_2', async () => {
    enterPhase(db, reviewId, 'phase_2');

    const clientVerdicts: ClientVerdict[] = [];
    if (deps.citationClient !== undefined) {
      for (const reference of referencesForVerification(ctx.sectionMap)) {
        const { index, ...metadata } = reference;
        const verdict = await deps.citationClient.verifyReference(metadata);
        clientVerdicts.push({
          referenceIndex: index,
          title: metadata.title,
          status: verdict.status,
          source: verdict.source,
          confidence: verdict.confidence,
          matchedDoi: verdict.matchedDoi ?? null,
        });
      }
    }
    const clientVerdictJson = JSON.stringify(clientVerdicts, null, 2);

    const [scout, citation] = await Promise.all([
      runAgent<FieldContextScoutOutput>(deps, {
        reviewId,
        phase: 'phase_2',
        agent: 'field-context-scout',
        artefactName: 'p2-context',
        assembleInput: {
          parseQuality: ctx.parseQuality,
          manuscriptExcerpt: digest,
          artefacts: [{ label: 'Claim-evidence matrix', content: matrixJson }],
          routingNote:
            'No web retrieval tool is available in this build. Work from the manuscript and the provided context only. Where a comparator or benchmark would normally need retrieval, record it as not performable with the reason rather than inventing a source. Prefix findings REV-CTX.',
        },
      }),
      runAgent<CitationAuditorOutput>(deps, {
        reviewId,
        phase: 'phase_2',
        agent: 'citation-auditor',
        artefactName: 'p2-citations-llm',
        assembleInput: {
          parseQuality: ctx.parseQuality,
          artefacts: [
            { label: 'Reference list (metadata only)', content: referenceMetadataList(ctx.sectionMap) },
            {
              label: 'Existence verdicts from the verification client (authoritative for existence)',
              content: clientVerdictJson,
            },
            { label: 'Claim-evidence matrix', content: matrixJson },
          ],
          routingNote:
            'The verification client has already checked whether each reference exists against Crossref, OpenAlex, and Semantic Scholar; its verdicts are authoritative for existence. Do NOT assert on your own that a reference exists or is fabricated; judge only whether each reference supports the claim that cites it and audit reference-list hygiene. Prefix findings REV-REF.',
        },
      }),
    ]);

    const reconciled = citation.verifications.map((verification) => reconcileExistence(verification, clientVerdicts));

    mergeFindings(db, {
      reviewId,
      lensPrefix: 'CTX',
      phase: 'phase_2',
      agent: 'field-context-scout',
      fragments: scout.findings,
    });
    mergeFindings(db, {
      reviewId,
      lensPrefix: 'REF',
      phase: 'phase_2',
      agent: 'citation-auditor',
      fragments: citation.findings,
    });
    writeArtefact(reviewId, 'p2-citations', { ...citation, verifications: reconciled, clientVerdicts });

    insertEvent(db, {
      reviewId,
      kind: 'phase_transition',
      phase: 'phase_2',
      payload: { referencesChecked: clientVerdicts.length, comparators: scout.comparators.length },
    });
    upsertCheckpoint(db, {
      reviewId,
      phase: 'phase_2',
      status: 'completed',
      snapshot: { referencesChecked: clientVerdicts.length },
    });
  });
}

function anonymiseFindings(findings: ReturnType<typeof getCurrentFindings>): Array<Record<string, unknown>> {
  return findings.map((finding) => ({
    anchor: finding.manuscriptAnchor,
    claim: finding.claim,
    severity: finding.severity,
    epistemic: finding.epistemicStatus,
    confidence: finding.confidence,
  }));
}

function sanitiseSupersedes(findings: Finding[], knownIds: Set<string>): Finding[] {
  return findings.map((finding) =>
    finding.supersedes !== null && !knownIds.has(finding.supersedes) ? { ...finding, supersedes: null } : finding,
  );
}

export async function runPhase3(deps: EngineDeps, reviewId: string): Promise<void> {
  const { db } = deps;
  if (phaseDone(db, reviewId, 'phase_3')) {
    return;
  }
  const ctx = loadEngineContext(db, reviewId);
  const digest = manuscriptDigest(ctx.sectionMap);
  const analystA = readArtefact<ManuscriptStructure>(reviewId, 'p1-analyst-a');
  const analystB = readArtefact<ClaimDesignAnalysis>(reviewId, 'p1-analyst-b');
  const mapJson = JSON.stringify(analystA.manuscriptMap);
  const matrixJson = JSON.stringify(analystB.claimEvidenceMatrix);
  const active = selectActiveLenses(ctx.preset, analystB.activationMap);

  await withPhase('phase_3', async () => {
    enterPhase(db, reviewId, 'phase_3');

    const firstPass = await Promise.all(
      active.map((lens) =>
        runAgent<SpecialistReviewerOutput>(deps, {
          reviewId,
          phase: 'phase_3',
          agent: 'specialist-reviewer',
          artefactName: `p3-${lens.prefix}-first`,
          assembleInput: {
            lens: lens.display,
            parseQuality: ctx.parseQuality,
            manuscriptExcerpt: digest,
            artefacts: [
              { label: 'Manuscript map', content: mapJson },
              { label: 'Claim-evidence matrix', content: matrixJson },
            ],
            routingNote: `First pass, blind. Your lens is ${lens.display} (REV-${lens.prefix}); run only that lens's rubric. Prefix findings REV-${lens.prefix}. challengeRound must be null on the first pass. You have none of the other lenses' findings.`,
          },
        }).then((result) => ({ lens, result })),
      ),
    );

    const severitiesByPrefix = new Map<string, string[]>();
    for (const { lens, result } of firstPass) {
      mergeFindings(db, {
        reviewId,
        lensPrefix: lens.prefix,
        phase: 'phase_3',
        agent: 'specialist-reviewer',
        fragments: result.findings,
      });
      severitiesByPrefix.set(
        lens.prefix,
        result.findings.map((finding) => finding.severity),
      );
    }

    const challengeLenses = selectChallengeLenses(ctx.preset, active, severitiesByPrefix);
    const activePrefixes = new Set(active.map((lens) => lens.prefix));
    const postFirstPass = getCurrentFindings(db, reviewId);
    const specialistFindings = postFirstPass.filter((finding) => {
      const prefix = finding.id.split('-')[1] ?? '';
      return activePrefixes.has(prefix);
    });

    const context2 = JSON.stringify(readArtefact(reviewId, 'p2-context'));
    const citations2 = JSON.stringify(readArtefact(reviewId, 'p2-citations'));

    const challengeResults = await Promise.all(
      challengeLenses.map((lens) => {
        const mine = specialistFindings.filter((finding) => finding.id.startsWith(`REV-${lens.prefix}-`));
        const others = specialistFindings.filter((finding) => !finding.id.startsWith(`REV-${lens.prefix}-`));
        return runAgent<SpecialistReviewerOutput>(deps, {
          reviewId,
          phase: 'phase_3',
          agent: 'specialist-reviewer',
          artefactName: `p3-${lens.prefix}-challenge`,
          assembleInput: {
            lens: lens.display,
            parseQuality: ctx.parseQuality,
            manuscriptExcerpt: digest,
            artefacts: [
              { label: 'Manuscript map', content: mapJson },
              { label: 'Claim-evidence matrix', content: matrixJson },
              { label: 'Your first-pass findings (canonical ledger ids)', content: JSON.stringify(mine) },
              { label: "Other lenses' findings (anonymised)", content: JSON.stringify(anonymiseFindings(others)) },
              { label: 'Field context (Phase 2)', content: context2 },
              { label: 'Citation audit (Phase 2)', content: citations2 },
            ],
            routingNote: `Challenge round for ${lens.display} (REV-${lens.prefix}). In "findings", return ONLY new or updated findings; an update sets supersedes to the existing canonical id shown in your first-pass findings, and you never re-list an unchanged finding. Update a position ONLY on named new evidence, never because another lens disagreed. Preserve evidence-based dissent held at confidence 0.75 or higher in challengeRound.dissentPreserved rather than converging.`,
          },
        }).then((result) => ({ lens, result }));
      }),
    );

    const dissentPreserved: Array<{ lens: string; id: string; whyItHolds: string }> = [];
    for (const { lens, result } of challengeResults) {
      const knownIds = new Set(getCurrentFindings(db, reviewId).map((finding) => finding.id));
      const sanitised = sanitiseSupersedes(result.findings, knownIds);
      if (sanitised.length > 0) {
        mergeFindings(db, {
          reviewId,
          lensPrefix: lens.prefix,
          phase: 'phase_3',
          agent: 'specialist-reviewer',
          fragments: sanitised,
        });
      }
      for (const dissent of result.challengeRound?.dissentPreserved ?? []) {
        dissentPreserved.push({ lens: lens.prefix, id: dissent.id, whyItHolds: dissent.whyItHolds });
      }
    }

    insertEvent(db, {
      reviewId,
      kind: 'phase_transition',
      phase: 'phase_3',
      payload: {
        activeLenses: active.map((lens) => lens.prefix),
        challengeLenses: challengeLenses.map((lens) => lens.prefix),
        dissentPreserved: dissentPreserved.length,
      },
    });
    upsertCheckpoint(db, {
      reviewId,
      phase: 'phase_3',
      status: 'completed',
      snapshot: {
        activeLenses: active.map((lens) => lens.prefix),
        challengeLenses: challengeLenses.map((lens) => lens.prefix),
        dissentPreserved,
      },
    });
  });
}

interface IntegrityCluster {
  name: string;
  prefixes: string[];
}

const INTEGRITY_CLUSTERS: IntegrityCluster[] = [
  { name: 'reporting-and-reproducibility', prefixes: ['RPT', 'RPX'] },
  { name: 'consistency-and-figures', prefixes: ['CON', 'FIG'] },
  { name: 'similarity-and-ai-content', prefixes: ['SIM', 'AIC'] },
];

function routeIntegrityPrefix(lens: string, allowed: string[]): string {
  const upper = lens.toUpperCase();
  for (const prefix of allowed) {
    if (upper.includes(prefix)) {
      return prefix;
    }
  }
  return allowed[0] ?? 'CON';
}

export async function runPhase4(deps: EngineDeps, reviewId: string): Promise<void> {
  const { db } = deps;
  if (phaseDone(db, reviewId, 'phase_4')) {
    return;
  }
  const ctx = loadEngineContext(db, reviewId);
  const digest = manuscriptDigest(ctx.sectionMap);
  const analystA = readArtefact<ManuscriptStructure>(reviewId, 'p1-analyst-a');
  const analystB = readArtefact<ClaimDesignAnalysis>(reviewId, 'p1-analyst-b');
  const mapJson = JSON.stringify(analystA.manuscriptMap);
  const inventoryJson = JSON.stringify(analystA.figureTableInventory);
  const matrixJson = JSON.stringify(analystB.claimEvidenceMatrix);

  await withPhase('phase_4', async () => {
    enterPhase(db, reviewId, 'phase_4');

    const results = await Promise.all(
      INTEGRITY_CLUSTERS.map((cluster) =>
        runAgent<IntegrityScreenerOutput>(deps, {
          reviewId,
          phase: 'phase_4',
          agent: 'integrity-screener',
          artefactName: `p4-${cluster.name}`,
          assembleInput: {
            parseQuality: ctx.parseQuality,
            manuscriptExcerpt: digest,
            artefacts: [
              { label: 'Manuscript map', content: mapJson },
              { label: 'Figure and table inventory', content: inventoryJson },
              { label: 'Claim-evidence matrix', content: matrixJson },
            ],
            routingNote: `Integrity cluster "${cluster.name}", rubrics ${cluster.prefixes
              .map((prefix) => `REV-${prefix}`)
              .join(' and ')}. No external similarity report or AI-content detector output is provided; mark any check that needs one as not-run with the artifact named, never improvised. Findings are editorial signals, never verdicts; a serious signal is editor-only. Set each finding's lens to its rubric code and prefix its id REV-<rubric>.`,
          },
        }).then((result) => ({ cluster, result })),
      ),
    );

    for (const { cluster, result } of results) {
      const groups = new Map<string, Finding[]>();
      for (const finding of result.findings) {
        const prefix = routeIntegrityPrefix(finding.lens, cluster.prefixes);
        const enforced: Finding =
          (finding.severity === 'major' || finding.severity === 'fatal') && finding.scope !== 'editor-only'
            ? { ...finding, scope: 'editor-only' }
            : finding;
        const bucket = groups.get(prefix) ?? [];
        bucket.push(enforced);
        groups.set(prefix, bucket);
      }
      for (const [prefix, fragments] of groups) {
        mergeFindings(db, {
          reviewId,
          lensPrefix: prefix,
          phase: 'phase_4',
          agent: 'integrity-screener',
          fragments,
        });
      }
    }

    insertEvent(db, {
      reviewId,
      kind: 'phase_transition',
      phase: 'phase_4',
      payload: { clusters: INTEGRITY_CLUSTERS.map((cluster) => cluster.name) },
    });
    upsertCheckpoint(db, {
      reviewId,
      phase: 'phase_4',
      status: 'completed',
      snapshot: { clusters: INTEGRITY_CLUSTERS.map((cluster) => cluster.name) },
    });
  });
}

export async function runPhase5(deps: EngineDeps, reviewId: string): Promise<void> {
  const { db } = deps;
  if (phaseDone(db, reviewId, 'phase_5')) {
    return;
  }
  const ctx = loadEngineContext(db, reviewId);
  const analystB = readArtefact<ClaimDesignAnalysis>(reviewId, 'p1-analyst-b');
  const current = getCurrentFindings(db, reviewId);
  const profile = swarmProfile(ctx.preset);

  const seed = {
    manuscriptCard: {
      title: ctx.sectionMap.title,
      studyDesign: analystB.studyDesign,
      designConfidence: analystB.designConfidence,
    },
    findings: current.slice(0, 40).map((finding) => ({
      id: finding.id,
      claim: finding.claim,
      anchor: finding.manuscriptAnchor,
      severity: finding.severity,
      confidence: finding.confidence,
      scope: finding.scope,
      minority: false,
    })),
    note: 'Author identity is redacted. Integrity items are signals, not verdicts. The packet does not lean toward any recommendation.',
  };

  await withPhase('phase_5', async () => {
    enterPhase(db, reviewId, 'phase_5');

    const swarm = await runAgent<SwarmEvaluation>(deps, {
      reviewId,
      phase: 'phase_5',
      agent: 'swarm',
      mode: 'A',
      artefactName: 'p5-swarm',
      assembleInput: {
        mode: 'A',
        parseQuality: ctx.parseQuality,
        artefacts: [{ label: 'Swarm seed packet', content: JSON.stringify(seed, null, 2) }],
        routingNote: `Mode A. Preset ${ctx.preset}: build ${profile.populationSize} stratified reviewer profiles and run rounds ${profile.rounds}; populationSize in your output must be ${profile.populationSize}. Compute consensus entropy as Shannon bits across the five recommendation categories. Classify findings stable or fragile with round-by-round support. Return the strongest minority report and the herding risk. Any surfaced findings take prefix REV-SWM; stable and fragile lists reference existing ledger ids only.`,
      },
    });

    const knownIds = new Set(current.map((finding) => finding.id));
    const surfaced = sanitiseSupersedes(swarm.surfacedFindings, knownIds);
    if (surfaced.length > 0) {
      mergeFindings(db, {
        reviewId,
        lensPrefix: 'SWM',
        phase: 'phase_5',
        agent: 'swarm',
        fragments: surfaced,
      });
    }

    insertEvent(db, {
      reviewId,
      kind: 'phase_transition',
      phase: 'phase_5',
      payload: {
        consensusEntropy: swarm.consensusEntropy,
        decisionStability: swarm.decisionStability,
        herdingRisk: swarm.herdingRisk,
      },
    });
    upsertCheckpoint(db, {
      reviewId,
      phase: 'phase_5',
      status: 'completed',
      snapshot: {
        consensusEntropy: swarm.consensusEntropy,
        decisionStability: swarm.decisionStability,
        populationSize: swarm.populationSize,
      },
    });
  });
}

export async function runPhase6(deps: EngineDeps, reviewId: string): Promise<void> {
  const { db } = deps;
  if (phaseDone(db, reviewId, 'phase_6')) {
    return;
  }
  const current = getCurrentFindings(db, reviewId);
  const ledgerIds = new Set(current.map((finding) => finding.id));
  const swarm = readArtefact<SwarmEvaluation>(reviewId, 'p5-swarm');

  const findingsForReport = current.map((finding) => ({
    id: finding.id,
    lens: finding.type,
    claim: finding.claim,
    anchor: finding.manuscriptAnchor,
    severity: finding.severity,
    fixability: finding.fixability,
    scope: finding.scope,
    epistemic: finding.epistemicStatus,
    confidence: finding.confidence,
    failureScenario: finding.narrativeContext,
    leanestFix: finding.recommendedAction,
  }));

  const groundingValidator = (value: unknown): void => {
    const report = value as FullReportEnvelope;
    const cited = new Set<string>([
      ...report.citedFindingIds,
      ...report.provisionalRubric.flatMap((row) => row.supportingIds),
    ]);
    const ungrounded = [...cited].filter((id) => !ledgerIds.has(id));
    if (ungrounded.length > 0) {
      throw new Error(
        `report cites finding ids that are not current in the ledger: ${ungrounded.join(', ')}. Cite only ids present in the merged evidence ledger.`,
      );
    }
  };

  await withPhase('phase_6', async () => {
    enterPhase(db, reviewId, 'phase_6');

    const report = await runAgent<FullReportEnvelope>(deps, {
      reviewId,
      phase: 'phase_6',
      agent: 'review-report-writer',
      mode: 'A',
      artefactName: 'p6-report',
      validate: groundingValidator,
      assembleInput: {
        mode: 'A',
        artefacts: [
          {
            label: 'Merged evidence ledger (current findings, canonical ids)',
            content: JSON.stringify(findingsForReport, null, 2),
          },
          { label: 'Swarm summary', content: JSON.stringify(swarm, null, 2) },
        ],
        routingNote:
          'Mode A full internal report. Every claim in bodyMarkdown and every provisional rubric row must cite Finding IDs that exist in the ledger above; list every id you cite in citedFindingIds. Order concerns by severity then fixability. Provide provisional 15-criterion scores each citing at least one Finding ID, the provisional average, and the three lowest criteria as bottlenecks.',
      },
    });

    for (const row of report.provisionalRubric) {
      upsertRubricScore(db, reviewId, {
        criterionIndex: row.criterion,
        score: row.score,
        justifyingFindingIds: row.supportingIds,
      });
    }

    const composite = computeComposite({
      currentFindings: current,
      ledgerIds,
      citedFindingIds: report.citedFindingIds,
      bodyMarkdown: report.bodyMarkdown,
      decisionStability: swarm.decisionStability,
    });
    writeArtefact(reviewId, 'p6-quality-composite', composite);

    insertEvent(db, {
      reviewId,
      kind: 'phase_transition',
      phase: 'phase_6',
      payload: { provisionalAverage: report.provisionalAverage, composite: composite.composite },
    });
    upsertCheckpoint(db, {
      reviewId,
      phase: 'phase_6',
      status: 'completed',
      snapshot: {
        provisionalAverage: report.provisionalAverage,
        bottlenecks: report.bottlenecks,
        composite: composite.composite,
      },
    });
  });
}

export async function runReviewEngine(deps: EngineDeps, reviewId: string): Promise<void> {
  await runPhase1(deps, reviewId);
  await runPhase2(deps, reviewId);
  await runPhase3(deps, reviewId);
  await runPhase4(deps, reviewId);
  await runPhase5(deps, reviewId);
  await runPhase6(deps, reviewId);
}
