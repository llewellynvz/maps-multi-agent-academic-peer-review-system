import type {
  AiContentAnalystOutput,
  ClaimDesignAnalysis,
  CitationAuditorOutput,
  CitationClaimsOutput,
  FieldContextScoutOutput,
  Finding,
  FullReportEnvelope,
  IntegrityScreenerOutput,
  ManuscriptStructure,
  ScoutPlan,
  SpecialistReviewerOutput,
  SwarmEvaluation,
} from '@mara/shared';
import { randomBytes } from 'node:crypto';
import type { MaraDatabase } from '../db/client';
import { type FetchLike, OPENALEX_HOST, reconstructAbstract, searchTopics, type TopicSearchResult } from '../citations';
import { getCurrentFindings } from '../ledger';
import { buildProtectedCorpus } from '../security';
import { withPhase } from '../tracing';
import { getCheckpoint, getReviewOptions, insertEvent, updateReview, upsertCheckpoint } from '../workflow/repo';
import { artefactExists, readArtefact, writeArtefact } from './artefacts';
import { computeComposite } from './composite';
import { mergeFindingsOnce } from './merge';
import {
  loadEngineContext,
  manuscriptDigest,
  referenceMetadataList,
  type ReferenceSkip,
  referencesForVerification,
} from './context';
import {
  applyPaperTypeLensPolicy,
  paperTypeNote,
  selectActiveLenses,
  selectChallengeLenses,
  studyDesignAffirmsData,
  swarmProfile,
} from './lenses';
import { readIntakeOptions } from './options';
import { runAgent } from './dispatch-agent';
import { type PhaseCritiqueInput, runPhaseCritique } from './phase-critique';
import { upsertRubricScore } from './rubric';
import type { EngineDeps } from './phases-shared';

export type { EngineDeps } from './phases-shared';

function checkpointKey(phase: string): string {
  return `engine_${phase}`;
}

function phaseDone(db: MaraDatabase, reviewId: string, phase: string): boolean {
  return getCheckpoint(db, reviewId, checkpointKey(phase))?.status === 'completed';
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
    mergeFindingsOnce(db, {
      reviewId,
      lensPrefix: 'MAP',
      phase: 'phase_1',
      agent: 'manuscript-analyst',
      fragments: sanitiseSupersedes(analystA.findings, new Set(getCurrentFindings(db, reviewId).map((finding) => finding.id))),
      marker: 'p1-analyst-a',
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
    mergeFindingsOnce(db, {
      reviewId,
      lensPrefix: 'MAP',
      phase: 'phase_1',
      agent: 'manuscript-analyst',
      fragments: sanitiseSupersedes(analystB.findings, new Set(getCurrentFindings(db, reviewId).map((finding) => finding.id))),
      marker: 'p1-analyst-b',
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
    await runPhaseCritique(deps, reviewId, 'phase_1', [
      { label: 'Manuscript analyst mode A output', content: JSON.stringify(analystA) },
      { label: 'Manuscript analyst mode B output', content: JSON.stringify(analystB) },
    ]);
    upsertCheckpoint(db, {
      reviewId,
      phase: checkpointKey('phase_1'),
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

function topicSearchCap(preset: string): number | null {
  if (preset === 'thorough') {
    return 8;
  }
  if (preset === 'balanced') {
    return 5;
  }
  return null;
}

function claimsCap(preset: string): number {
  return preset === 'thorough' ? 20 : 12;
}

async function fetchAbstractByDoi(fetchImpl: FetchLike, doi: string): Promise<string | null> {
  try {
    const clean = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    const url = new URL(`https://${OPENALEX_HOST}/works/doi:${clean}`);
    url.searchParams.set('select', 'abstract_inverted_index');
    const response = await fetchImpl(url.toString());
    if (!response.ok) {
      return null;
    }
    const json = (await response.json()) as Record<string, unknown> | null;
    return reconstructAbstract(json?.abstract_inverted_index) ?? null;
  } catch {
    return null;
  }
}

interface FetchedAbstract {
  referenceIndex: number;
  title: string;
  abstract: string | null;
}

const OFFLINE_SCOUT_NOTE =
  'No web retrieval tool is available in this build. Work from the manuscript and the provided context only. Where a comparator or benchmark would normally need retrieval, record it as not performable with the reason rather than inventing a source. Prefix findings REV-CTX.';

const SCOUT_PLAN_NOTE =
  'Mode plan. Derive the query vocabulary and 3 to 8 sharp topic queries from construct, method, and field terms only. Never place a manuscript sentence, the title, or an author name into a query: the deterministic egress guard blocks any query that shares an eight-gram with the manuscript, so a quoting query is refused and its search is recorded as not performable. Return only the plan; emit no dossier and no findings in this mode.';

const DOSSIER_SCOUT_NOTE =
  'Build the field dossier from the topic search results only. Populate keyPapers (at most 15, each whyItMatters tied to THIS manuscript), benchmarks, contestedClaims, recentReviews, and methodNorms, plus the query vocabulary. Keep an honest retrievalLog from the executed queries, the gapMap, and the biasStatement. Engage only sources present in the results: a paper you cannot see in the results is a fabrication and must not appear. Prefix findings REV-CTX.';

function fieldDossierArtefact(reviewId: string, label: string): { label: string; content: string } | null {
  if (!artefactExists(reviewId, 'p2-context')) {
    return null;
  }
  const dossier = readArtefact<FieldContextScoutOutput>(reviewId, 'p2-context');
  const keyPapers = Array.isArray(dossier.keyPapers) ? dossier.keyPapers : [];
  if (keyPapers.length === 0) {
    return null;
  }
  return {
    label,
    content: JSON.stringify({
      keyPapers,
      benchmarks: dossier.benchmarks,
      contestedClaims: dossier.contestedClaims,
      methodNorms: dossier.methodNorms,
    }),
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
  const topicCap = topicSearchCap(ctx.preset);
  const intake = readIntakeOptions(getReviewOptions(db, reviewId));

  await withPhase('phase_2', async () => {
    enterPhase(db, reviewId, 'phase_2');

    let scoutPlan: ScoutPlan | null = null;
    if (topicCap !== null) {
      scoutPlan = await runAgent<ScoutPlan>(deps, {
        reviewId,
        phase: 'phase_2',
        agent: 'field-context-scout',
        mode: 'plan',
        artefactName: 'p2-scout-plan',
        assembleInput: {
          mode: 'plan',
          parseQuality: ctx.parseQuality,
          manuscriptExcerpt: digest,
          artefacts: [{ label: 'Claim-evidence matrix', content: matrixJson }],
          routingNote: SCOUT_PLAN_NOTE,
        },
      });
    }

    let executedQueries: string[] = [];
    let skippedQueries: string[] = [];
    if (scoutPlan !== null) {
      const cap = topicCap ?? scoutPlan.topicQueries.length;
      executedQueries = scoutPlan.topicQueries.slice(0, cap).map((entry) => entry.query);
      skippedQueries = scoutPlan.topicQueries.slice(cap).map((entry) => entry.query);
    }

    const clientVerdicts: ClientVerdict[] = [];
    let topicResults: TopicSearchResult[] = [];
    let referenceSkips: ReferenceSkip[] = [];
    const claimAbstracts: FetchedAbstract[] = [];
    const retrievalActive =
      deps.egress !== undefined &&
      (deps.citationClient !== undefined || executedQueries.length > 0 || intake.claimCheck);
    if (retrievalActive && deps.egress !== undefined) {
      deps.egress.begin({
        reviewId,
        signingKey: randomBytes(32),
        corpus: buildProtectedCorpus(ctx.sectionMap),
        log: (entry) =>
          insertEvent(db, {
            reviewId,
            kind: 'web_query',
            phase: 'phase_2',
            egressTarget: entry.target,
            egressQuery: entry.query,
            payload: { blocked: entry.blocked, reason: entry.reason, signature: entry.signature },
          }),
      });
    }
    try {
      if (deps.citationClient !== undefined) {
        const { references, skipped } = referencesForVerification(ctx.sectionMap, intake.referenceAudit);
        referenceSkips = skipped;
        for (const reference of references) {
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
      if (executedQueries.length > 0 && deps.egress !== undefined) {
        topicResults = await searchTopics(executedQueries, deps.egress.fetch, {
          maxQueries: topicCap ?? executedQueries.length,
          perQueryPerSource: 5,
        });
      }
      if (intake.claimCheck && deps.egress !== undefined) {
        const verified = clientVerdicts.filter((verdict) => verdict.status === 'verified' && verdict.matchedDoi !== null);
        for (const verdict of verified.slice(0, claimsCap(ctx.preset))) {
          const abstract = await fetchAbstractByDoi(deps.egress.fetch, verdict.matchedDoi as string);
          claimAbstracts.push({ referenceIndex: verdict.referenceIndex, title: verdict.title, abstract });
        }
      }
    } finally {
      if (retrievalActive) {
        deps.egress?.end();
      }
    }
    const clientVerdictJson = JSON.stringify(clientVerdicts, null, 2);

    const topicResultsPayload = { executedQueries, skippedQueries, results: topicResults };
    if (scoutPlan !== null) {
      writeArtefact(reviewId, 'p2-topic-results', topicResultsPayload);
    }

    const scoutArtefacts = [{ label: 'Claim-evidence matrix', content: matrixJson }];
    let scoutRoutingNote = OFFLINE_SCOUT_NOTE;
    if (scoutPlan !== null) {
      scoutArtefacts.push({
        label: 'Topic search results (engage only sources present here)',
        content: JSON.stringify(topicResultsPayload),
      });
      scoutRoutingNote = DOSSIER_SCOUT_NOTE;
    }

    const [scout, citation] = await Promise.all([
      runAgent<FieldContextScoutOutput>(deps, {
        reviewId,
        phase: 'phase_2',
        agent: 'field-context-scout',
        artefactName: 'p2-context',
        assembleInput: {
          parseQuality: ctx.parseQuality,
          manuscriptExcerpt: digest,
          artefacts: scoutArtefacts,
          routingNote: scoutRoutingNote,
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

    const knownIds = new Set(getCurrentFindings(db, reviewId).map((finding) => finding.id));
    mergeFindingsOnce(db, {
      reviewId,
      lensPrefix: 'CTX',
      phase: 'phase_2',
      agent: 'field-context-scout',
      fragments: sanitiseSupersedes(scout.findings, knownIds),
      marker: 'p2-context',
    });
    mergeFindingsOnce(db, {
      reviewId,
      lensPrefix: 'REF',
      phase: 'phase_2',
      agent: 'citation-auditor',
      fragments: sanitiseSupersedes(citation.findings, knownIds),
      marker: 'p2-citations',
    });
    writeArtefact(reviewId, 'p2-citations', {
      ...citation,
      verifications: reconciled,
      clientVerdicts,
      referencesSkipped: referenceSkips,
    });

    let claims: CitationClaimsOutput | null = null;
    if (intake.claimCheck) {
      const abstractByIndex = new Map(claimAbstracts.map((entry) => [entry.referenceIndex, entry]));
      const claimWorklist = reconciled
        .filter((verification) => abstractByIndex.has(verification.referenceIndex as number))
        .map((verification) => {
          const fetched = abstractByIndex.get(verification.referenceIndex as number);
          return {
            referenceTitle: fetched?.title ?? '',
            claim: typeof verification.citation === 'string' ? verification.citation : '',
            abstract: fetched?.abstract ?? 'No abstract was retrievable for this reference.',
          };
        });
      const refFindings = getCurrentFindings(db, reviewId).filter((finding) => finding.id.startsWith('REV-REF-'));
      claims = await runAgent<CitationClaimsOutput>(deps, {
        reviewId,
        phase: 'phase_2',
        agent: 'citation-auditor',
        mode: 'claims',
        artefactName: 'p2-citations-claims',
        assembleInput: {
          mode: 'claims',
          parseQuality: ctx.parseQuality,
          artefacts: [
            {
              label: 'Load-bearing references with retrieved abstracts and the claim each is cited for',
              content: JSON.stringify(claimWorklist, null, 2),
            },
            { label: 'Claim-evidence matrix', content: matrixJson },
            {
              label: 'First-pass reference findings (canonical ledger ids; supersede a contradicted one by id)',
              content: JSON.stringify(refFindings, null, 2),
            },
          ],
          routingNote:
            "Mode claims. Judge each reference-and-claim pair using only the supplied abstract; abstract_unavailable is the honest verdict where no abstract is present, and you never guess support from the title or memory. Where a verdict contradicts a first-pass reference finding, emit a REV-REF finding whose supersedes is that finding's canonical id shown above. Prefix findings REV-REF.",
        },
      });
      const claimsKnownIds = new Set(getCurrentFindings(db, reviewId).map((finding) => finding.id));
      mergeFindingsOnce(db, {
        reviewId,
        lensPrefix: 'REF',
        phase: 'phase_2',
        agent: 'citation-auditor',
        fragments: sanitiseSupersedes(claims.findings, claimsKnownIds),
        marker: 'p2-citations-claims',
      });
    }

    insertEvent(db, {
      reviewId,
      kind: 'phase_transition',
      phase: 'phase_2',
      payload: {
        referencesChecked: clientVerdicts.length,
        comparators: scout.comparators.length,
        referencesSkipped: referenceSkips.length,
        claimsChecked: claims !== null ? claims.assessments.length : 0,
      },
    });
    const phase2Critique: PhaseCritiqueInput[] = [
      { label: 'Field context dossier', content: JSON.stringify(scout) },
      { label: 'Citation audit', content: JSON.stringify({ ...citation, verifications: reconciled }) },
    ];
    if (claims !== null) {
      phase2Critique.push({ label: 'Claim-versus-abstract support check', content: JSON.stringify(claims) });
    }
    if (scoutPlan !== null) {
      phase2Critique.push({ label: 'Topic search results', content: JSON.stringify(topicResultsPayload) });
    }
    await runPhaseCritique(deps, reviewId, 'phase_2', phase2Critique);
    upsertCheckpoint(db, {
      reviewId,
      phase: checkpointKey('phase_2'),
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
  const intake = readIntakeOptions(getReviewOptions(db, reviewId));
  const affirmsData = studyDesignAffirmsData(analystB.studyDesign);
  const active = applyPaperTypeLensPolicy(
    selectActiveLenses(ctx.preset, analystB.activationMap),
    intake.paperType,
    affirmsData,
  );
  const typeNote = paperTypeNote(intake.paperType);

  const dossierArtefact = fieldDossierArtefact(reviewId, 'Field dossier (engage these works by name)');

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
              ...(dossierArtefact !== null ? [dossierArtefact] : []),
            ],
            routingNote: `First pass, blind. Your lens is ${lens.display} (REV-${lens.prefix}); run only that lens's rubric. Prefix findings REV-${lens.prefix}. challengeRound must be null on the first pass. You have none of the other lenses' findings.${typeNote !== null ? ` ${typeNote}` : ''}`,
          },
        }).then((result) => ({ lens, result })),
      ),
    );

    const severitiesByPrefix = new Map<string, string[]>();
    for (const { lens, result } of firstPass) {
      mergeFindingsOnce(db, {
        reviewId,
        lensPrefix: lens.prefix,
        phase: 'phase_3',
        agent: 'specialist-reviewer',
        fragments: result.findings,
        marker: `p3-${lens.prefix}-first`,
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
              ...(dossierArtefact !== null ? [dossierArtefact] : []),
            ],
            routingNote: `Challenge round for ${lens.display} (REV-${lens.prefix}). In "findings", return ONLY new or updated findings; an update sets supersedes to the existing canonical id shown in your first-pass findings, and you never re-list an unchanged finding. Update a position ONLY on named new evidence, never because another lens disagreed. Preserve evidence-based dissent held at confidence 0.75 or higher in challengeRound.dissentPreserved rather than converging.${typeNote !== null ? ` ${typeNote}` : ''}`,
          },
        }).then((result) => ({ lens, result }));
      }),
    );

    const dissentPreserved: Array<{ lens: string; id: string; whyItHolds: string }> = [];
    for (const { lens, result } of challengeResults) {
      const knownIds = new Set(getCurrentFindings(db, reviewId).map((finding) => finding.id));
      const sanitised = sanitiseSupersedes(result.findings, knownIds);
      if (sanitised.length > 0) {
        mergeFindingsOnce(db, {
          reviewId,
          lensPrefix: lens.prefix,
          phase: 'phase_3',
          agent: 'specialist-reviewer',
          fragments: sanitised,
          marker: `p3-${lens.prefix}-challenge`,
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
    const phase3Findings = getCurrentFindings(db, reviewId).filter((finding) =>
      activePrefixes.has(finding.id.split('-')[1] ?? ''),
    );
    await runPhaseCritique(deps, reviewId, 'phase_3', [
      {
        label: 'Merged specialist findings',
        content: JSON.stringify(
          phase3Findings.map((finding) => ({
            id: finding.id,
            lens: finding.type,
            claim: finding.claim,
            anchor: finding.manuscriptAnchor,
            severity: finding.severity,
            scope: finding.scope,
            confidence: finding.confidence,
          })),
        ),
      },
      { label: 'Specialist activation map', content: JSON.stringify(analystB.activationMap) },
    ]);
    upsertCheckpoint(db, {
      reviewId,
      phase: checkpointKey('phase_3'),
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
  const intake = readIntakeOptions(getReviewOptions(db, reviewId));
  const clusters: IntegrityCluster[] = intake.aiDetection
    ? INTEGRITY_CLUSTERS.map((cluster) =>
        cluster.name === 'similarity-and-ai-content' ? { ...cluster, prefixes: ['SIM'] } : cluster,
      )
    : INTEGRITY_CLUSTERS;

  await withPhase('phase_4', async () => {
    enterPhase(db, reviewId, 'phase_4');

    const results = await Promise.all(
      clusters.map((cluster) => {
        const aiHandledElsewhere = cluster.name === 'similarity-and-ai-content' && intake.aiDetection;
        return runAgent<IntegrityScreenerOutput>(deps, {
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
              .join(' and ')}. ${aiHandledElsewhere ? 'AI-content screening (REV-AIC) is handled by the dedicated AI-content analyst in this run; screen similarity signals only and do not emit REV-AIC findings. ' : ''}No external similarity report or AI-content detector output is provided; mark any check that needs one as not-run with the artifact named, never improvised. Findings are editorial signals, never verdicts; a serious signal is editor-only. Set each finding's lens to its rubric code and prefix its id REV-<rubric>.`,
          },
        }).then((result) => ({ cluster, result }));
      }),
    );

    const knownIds = new Set(getCurrentFindings(db, reviewId).map((finding) => finding.id));
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
        mergeFindingsOnce(db, {
          reviewId,
          lensPrefix: prefix,
          phase: 'phase_4',
          agent: 'integrity-screener',
          fragments: sanitiseSupersedes(fragments, knownIds),
          marker: `p4-${cluster.name}-${prefix}`,
        });
      }
    }

    let aiContent: AiContentAnalystOutput | null = null;
    if (intake.aiDetection) {
      const citationVerdicts = artefactExists(reviewId, 'p2-citations')
        ? readArtefact<{ verifications?: unknown }>(reviewId, 'p2-citations').verifications ?? []
        : [];
      aiContent = await runAgent<AiContentAnalystOutput>(deps, {
        reviewId,
        phase: 'phase_4',
        agent: 'ai-content-analyst',
        artefactName: 'p4-ai-content',
        assembleInput: {
          parseQuality: ctx.parseQuality,
          manuscriptExcerpt: digest,
          artefacts: [
            { label: 'Manuscript structure (analyst mode A)', content: JSON.stringify(analystA) },
            { label: 'Reconciled citation verdicts', content: JSON.stringify(citationVerdicts) },
          ],
          routingNote:
            'Weigh AI-content signals from the manuscript and the reconciled citation verdicts only; no detector exists or may be called. Every signal carries its own false-positive caveat and the analysis carries the standing ESL caveat. Fabricated or unlocatable references are the strongest single tell; stylometric and uniformity readings are the weakest and you say so. Signals are editorial signals, never verdicts; a serious signal is editor-only. Prefix findings REV-AIC.',
        },
      });
      const aiKnownIds = new Set(getCurrentFindings(db, reviewId).map((finding) => finding.id));
      const enforced = aiContent.findings.map((finding): Finding =>
        (finding.severity === 'major' || finding.severity === 'fatal') && finding.scope !== 'editor-only'
          ? { ...finding, scope: 'editor-only' }
          : finding,
      );
      mergeFindingsOnce(db, {
        reviewId,
        lensPrefix: 'AIC',
        phase: 'phase_4',
        agent: 'ai-content-analyst',
        fragments: sanitiseSupersedes(enforced, aiKnownIds),
        marker: 'p4-ai-content',
      });
    }

    insertEvent(db, {
      reviewId,
      kind: 'phase_transition',
      phase: 'phase_4',
      payload: {
        clusters: clusters.map((cluster) => cluster.name),
        aiContent: intake.aiDetection ? 'run' : 'skipped',
      },
    });
    const phase4Critique: PhaseCritiqueInput[] = [
      {
        label: 'Integrity cluster outputs',
        content: JSON.stringify(
          results.map((entry) => ({
            cluster: entry.cluster.name,
            selfCritique: entry.result.selfCritique,
            checks: entry.result.checks,
            findings: entry.result.findings,
          })),
        ),
      },
    ];
    if (aiContent !== null) {
      phase4Critique.push({ label: 'AI-content analysis', content: JSON.stringify(aiContent) });
    }
    await runPhaseCritique(deps, reviewId, 'phase_4', phase4Critique);
    upsertCheckpoint(db, {
      reviewId,
      phase: checkpointKey('phase_4'),
      status: 'completed',
      snapshot: { clusters: clusters.map((cluster) => cluster.name), aiContent: intake.aiDetection },
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
      mergeFindingsOnce(db, {
        reviewId,
        lensPrefix: 'SWM',
        phase: 'phase_5',
        agent: 'swarm',
        fragments: surfaced,
        marker: 'p5-swarm',
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
    await runPhaseCritique(deps, reviewId, 'phase_5', [
      { label: 'Swarm evaluation summary', content: JSON.stringify(swarm) },
    ]);
    upsertCheckpoint(db, {
      reviewId,
      phase: checkpointKey('phase_5'),
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

  const dossierArtefact = fieldDossierArtefact(reviewId, 'Field dossier (the only literature you may name)');
  const typeNote = paperTypeNote(readIntakeOptions(getReviewOptions(db, reviewId)).paperType);

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
          ...(dossierArtefact !== null ? [dossierArtefact] : []),
        ],
        routingNote:
          `Mode A full internal report. Every claim in bodyMarkdown and every provisional rubric row must cite Finding IDs that exist in the ledger above; list every id you cite in citedFindingIds. Order concerns by severity then fixability. Provide provisional 15-criterion scores each citing at least one Finding ID, the provisional average, and the three lowest criteria as bottlenecks.${typeNote !== null ? ` ${typeNote}` : ''}`,
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
    await runPhaseCritique(deps, reviewId, 'phase_6', [
      { label: 'Full internal report', content: report.bodyMarkdown },
    ]);
    upsertCheckpoint(db, {
      reviewId,
      phase: checkpointKey('phase_6'),
      status: 'completed',
      snapshot: {
        provisionalAverage: report.provisionalAverage,
        bottlenecks: report.bottlenecks,
        composite: composite.composite,
      },
    });
  });
}

export { runPhase7 } from './phase7';
export { runPhase8 } from './phase8';
