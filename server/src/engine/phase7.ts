import { sql } from 'drizzle-orm';
import type {
  FieldContextScoutOutput,
  FullReportEnvelope,
  PriorStressTestOutput,
  Recommendation,
  ReviewFinalCriticOutput,
  ReviewMetaReviewerOutput,
  ShippedReportEnvelope,
  SpecialistReviewerOutput,
  SwarmEvaluation,
  SwarmReportCritique,
} from '@mara/shared';
import type { CurrentFinding } from '../ledger';
import { getCurrentFindings } from '../ledger';
import { annotatePhase, withPhase } from '../tracing';
import {
  getCheckpoint,
  getReviewOptions,
  insertEvent,
  recordGateCheckpoint,
  updateReview,
  upsertCheckpoint,
} from '../workflow/repo';
import { DispatchPauseError, type EngineDeps } from './phases-shared';
import { artefactExists, readArtefact, writeArtefact } from './artefacts';
import { loadEngineContext, manuscriptDigest } from './context';
import { runAgent } from './dispatch-agent';
import { arbitrate, type ArbitrationRecord } from './arbitration';
import {
  bodyHeadings,
  labelAppearsInBody,
  redactEditorOnlyIds,
  redactSupersededIds,
  validateGrounding,
  type GroundingFailureKind,
} from './grounding';
import { matchLens, paperTypeNote } from './lenses';
import { mergeFindingsOnce } from './merge';
import { readIntakeOptions } from './options';
import { assemblePrivateNotes } from './private-notes';
import { upsertFinalRubricScore } from './rubric';

const MAX_FIX_CYCLES = 2;

function checkpointKey(phase: string): string {
  return `engine_${phase}`;
}

function fieldDossierContent(reviewId: string): string | null {
  if (!artefactExists(reviewId, 'p2-context')) {
    return null;
  }
  const dossier = readArtefact<FieldContextScoutOutput>(reviewId, 'p2-context');
  const keyPapers = Array.isArray(dossier.keyPapers) ? dossier.keyPapers : [];
  if (keyPapers.length === 0) {
    return null;
  }
  return JSON.stringify({
    keyPapers,
    benchmarks: dossier.benchmarks,
    contestedClaims: dossier.contestedClaims,
    methodNorms: dossier.methodNorms,
  });
}

function emitGateVerdict(
  db: EngineDeps['db'],
  reviewId: string,
  payload: { cycle: number; source: string; verdict: string } & Record<string, unknown>,
): void {
  const existing = db.all(
    sql`SELECT 1 FROM review_events WHERE review_id = ${reviewId} AND kind = 'gate_verdict'
        AND json_extract(payload_json, '$.cycle') = ${payload.cycle}
        AND json_extract(payload_json, '$.source') = ${payload.source}
        AND json_extract(payload_json, '$.verdict') = ${payload.verdict}
        LIMIT 1`,
  );
  if (existing.length > 0) {
    return;
  }
  insertEvent(db, { reviewId, kind: 'gate_verdict', phase: 'phase_7', payload });
}

function phaseDone(deps: EngineDeps, reviewId: string): boolean {
  return getCheckpoint(deps.db, reviewId, checkpointKey('phase_7'))?.status === 'completed';
}

function journalLabel(options: Record<string, unknown>): string {
  const answers = (options.answers ?? {}) as Record<string, unknown>;
  const journal = typeof answers.journal === 'string' ? answers.journal : null;
  return journal ?? 'not supplied';
}

function fieldLabel(options: Record<string, unknown>): string {
  const answers = (options.answers ?? {}) as Record<string, unknown>;
  const field = typeof answers.field === 'string' ? answers.field : null;
  return field ?? 'not supplied';
}

function ledgerForReport(findings: CurrentFinding[]): Array<Record<string, unknown>> {
  return findings.map((finding) => ({
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
}

function repairEvidenceLabels(shipped: ShippedReportEnvelope): ShippedReportEnvelope['evidenceMap'] {
  const headings = bodyHeadings(shipped.bodyMarkdown);
  const lower = headings.map((heading) => heading.toLowerCase());
  return shipped.evidenceMap.map((entry) => {
    if (labelAppearsInBody(shipped.bodyMarkdown, entry.label)) {
      return entry;
    }
    const sectionKey = entry.section
      .replace(/^4[AB][.\d]*\s*/i, '')
      .trim()
      .toLowerCase();
    if (sectionKey.length < 3) {
      return entry;
    }
    const index = lower.findIndex(
      (heading) =>
        heading === sectionKey || heading.startsWith(sectionKey) || (sectionKey.startsWith(heading) && heading.length >= 8),
    );
    return index >= 0 ? { ...entry, label: headings[index] as string } : entry;
  });
}

function withDerivedCitedIds(shipped: ShippedReportEnvelope): ShippedReportEnvelope {
  const evidenceMap = repairEvidenceLabels(shipped);
  return { ...shipped, evidenceMap, citedFindingIds: [...new Set(evidenceMap.flatMap((entry) => entry.findingIds))] };
}

function recommendationPackage(meta: ReviewMetaReviewerOutput): Record<string, unknown> {
  return {
    recommendation: meta.recommendation,
    recommendationConfidence: meta.recommendationConfidence,
    rubric: meta.rubric,
    average: meta.average,
    bottlenecks: meta.bottlenecks,
    scopeFit: meta.scopeFit,
    decisionHinges: meta.decisionHinges,
  };
}

async function runMetaReviewer(
  deps: EngineDeps,
  reviewId: string,
  cycle: number,
  digest: string,
  report: FullReportEnvelope,
  swarm: SwarmEvaluation,
  findings: CurrentFinding[],
  ledgerIds: Set<string>,
  options: Record<string, unknown>,
): Promise<ReviewMetaReviewerOutput> {
  const meta = await runAgent<ReviewMetaReviewerOutput>(deps, {
    reviewId,
    phase: 'phase_7',
    agent: 'review-meta-reviewer',
    artefactName: `p7-meta-${cycle}`,
    validate: (value) => {
      const synthesis = value as ReviewMetaReviewerOutput;
      const cited = new Set<string>([
        ...synthesis.rubric.flatMap((row) => [...row.supportingIds, ...row.opposingIds]),
        ...synthesis.decisionHinges.map((hinge) => hinge.findingId),
      ]);
      const ungrounded = [...cited].filter((id) => !ledgerIds.has(id));
      if (ungrounded.length > 0) {
        throw new Error(
          `meta synthesis cites finding ids not present in the ledger: ${ungrounded.join(', ')}. Cite only current ledger ids in rubric supporting/opposing ids and decision hinges.`,
        );
      }
    },
    assembleInput: {
      parseQuality: loadEngineContext(deps.db, reviewId).parseQuality,
      manuscriptExcerpt: digest,
      artefacts: [
        {
          label: 'Merged evidence ledger (current findings, canonical ids)',
          content: JSON.stringify(ledgerForReport(findings), null, 2),
        },
        { label: 'Full internal report (Phase 6)', content: redactSupersededIds(report.bodyMarkdown, ledgerIds) },
        { label: 'Swarm summary (Phase 5)', content: redactSupersededIds(JSON.stringify(swarm, null, 2), ledgerIds) },
        { label: 'Brief', content: `Journal: ${journalLabel(options)}. Field: ${fieldLabel(options)}.` },
        { label: 'Cross-review calibration lessons', content: 'No calibration record yet (early-run condition).' },
      ],
      routingNote:
        'Integrate every lens, integrity, and swarm finding into one editorial synthesis. Score all 15 criteria, each row citing supporting and opposing finding ids that exist in the ledger above. Set the recommendation by the taxonomy and thresholds, pulled down never up by severity and fixability. Give one decision hinge per major finding, each naming a real finding id. Compute the unweighted average to one decimal. Author editorSummaryMarkdown for the handling editor: the decision rationale, scope fit, integrity matters in signal language, and the preserved alternative reading at full strength, citing only current finding ids.',
    },
  });
  for (const row of meta.rubric) {
    upsertFinalRubricScore(deps.db, reviewId, {
      criterionIndex: row.criterion,
      score: row.score,
      justifyingFindingIds: row.supportingIds,
    });
  }
  writeArtefact(reviewId, 'p7-meta-final', meta);
  return meta;
}

export async function runPhase7(deps: EngineDeps, reviewId: string): Promise<void> {
  const { db } = deps;
  if (phaseDone(deps, reviewId)) {
    return;
  }

  const ctx = loadEngineContext(db, reviewId);
  const digest = manuscriptDigest(ctx.sectionMap);
  const options = getReviewOptions(db, reviewId);
  const intake = readIntakeOptions(options);
  const typeNote = paperTypeNote(intake.paperType);
  const report = readArtefact<FullReportEnvelope>(reviewId, 'p6-report');
  const swarm = readArtefact<SwarmEvaluation>(reviewId, 'p5-swarm');
  const dossierContent = fieldDossierContent(reviewId);

  await withPhase('phase_7', async () => {
    updateReview(db, reviewId, { status: 'running', currentPhase: 'phase_7' });

    const findings = getCurrentFindings(db, reviewId);
    const ledgerIds = new Set(findings.map((finding) => finding.id));

    const [meta0, swarmCritique] = await Promise.all([
      runMetaReviewer(deps, reviewId, 0, digest, report, swarm, findings, ledgerIds, options),
      runAgent<SwarmReportCritique>(deps, {
        reviewId,
        phase: 'phase_7',
        agent: 'swarm',
        mode: 'B',
        artefactName: 'p7-swarm-b',
        assembleInput: {
          mode: 'B',
          artefacts: [
            { label: 'Draft internal report', content: report.bodyMarkdown },
            {
              label: 'Merged evidence ledger (current findings, canonical ids)',
              content: JSON.stringify(ledgerForReport(findings), null, 2),
            },
          ],
          routingNote:
            'Mode B report critique. Run the population against the draft report. Flag statements the ledger does not support or that are harsher than their ledger severity, major concerns present in the ledger but missing from the report, anchoring on dispatch order, and an unfair strengths section. Quote the report line and cite the ledger id each item fails against.',
        },
      }),
    ]);

    let currentMeta = meta0;
    let fixCycles = 0;
    let released = false;
    let releaseVerdict: 'pass' | 'arbitrated' = 'pass';
    let finalRecommendation: Recommendation = currentMeta.recommendation;
    let finalConfidence = currentMeta.recommendationConfidence;
    let arbitration: ArbitrationRecord | null = null;
    let blocked = false;
    let blockReason = '';
    let lastGroundingFailureKind: GroundingFailureKind = null;
    let lastObjection = '';
    let priorDefect = '';
    let lastShipped: ShippedReportEnvelope | null = null;
    let lastPrivateNotes = '';

    for (let cycle = 0; ; cycle += 1) {
      const authorFacing = getCurrentFindings(db, reviewId).filter((finding) => finding.scope !== 'editor_only');
      const currentAll = getCurrentFindings(db, reviewId);
      const ledgerIdsNow = new Set(currentAll.map((finding) => finding.id));
      const editorOnlyIds = new Set(
        currentAll.filter((finding) => finding.scope === 'editor_only').map((finding) => finding.id),
      );

      const redact = (content: string): string =>
        redactSupersededIds(redactEditorOnlyIds(content, editorOnlyIds), ledgerIdsNow);
      const shippedRaw = await runAgent<ShippedReportEnvelope>(deps, {
        reviewId,
        phase: 'phase_7',
        agent: 'review-report-writer',
        mode: 'B',
        artefactName: `p7-shipped-${cycle}`,
        assembleInput: {
          mode: 'B',
          artefacts: [
            { label: 'Recommendation package (from the meta-reviewer)', content: redact(JSON.stringify(recommendationPackage(currentMeta), null, 2)) },
            { label: 'Swarm report critique (Phase 7 mode B)', content: redact(JSON.stringify(swarmCritique.critique, null, 2)) },
            { label: 'Full internal report (Phase 6, yours)', content: redact(report.bodyMarkdown) },
            {
              label: 'Author-facing ledger (cite only these ids; editor-only findings are excluded by construction)',
              content: JSON.stringify(ledgerForReport(authorFacing), null, 2),
            },
            ...(dossierContent !== null
              ? [{ label: 'Field dossier (the only literature you may name)', content: redact(dossierContent) }]
              : []),
          ],
          routingNote:
            `Mode B shipped seven-part peer-review report. Author-and-editor facing, anonymous, no editor-only content. The report body carries no finding ids and no machine tokens: write the recommendation and confidence as natural reviewer prose per the knowledge/06 register. Ground every 4A point and 4B subsection through evidenceMap entries whose findingIds come only from the author-facing ledger above and whose label matches the bold problem label in the body verbatim; citedFindingIds is exactly the union of evidenceMap ids. Any id shown as [EDITOR-ONLY] or [SUPERSEDED] in the other artefacts is off limits everywhere. Assert editorOnlyLeak false. Apply the swarm report critique. Use the recommendation and confidence from the recommendation package.${typeNote !== null ? ` ${typeNote}` : ''}${priorDefect.length > 0 ? ` The prior attempt was routed back: ${priorDefect}` : ''}`,
        },
      });

      const shipped = withDerivedCitedIds(shippedRaw);

      const privateNotes = assemblePrivateNotes({
        recommendation: currentMeta.recommendation,
        recommendationConfidence: currentMeta.recommendationConfidence,
        currentFindings: currentAll,
        strongestMinorityReport: swarm.strongestMinorityReport,
        editorSummaryMarkdown: redactSupersededIds(currentMeta.editorSummaryMarkdown, ledgerIdsNow),
      });
      writeArtefact(reviewId, `p7-private-notes-${cycle}`, privateNotes);
      lastShipped = shipped;
      lastPrivateNotes = privateNotes.markdown;

      const grounding = validateGrounding({
        authorFacingBody: shipped.bodyMarkdown,
        authorFacingCitedIds: shipped.citedFindingIds,
        privateNotesBody: privateNotes.markdown,
        privateNotesReferencedIds: privateNotes.referencedIds,
        ledgerIds: ledgerIdsNow,
        editorOnlyIds,
        idFreeProse: true,
        evidenceMap: shipped.evidenceMap,
        authorFacingAncillary: shipped.rubricTable.map((row) => row.justification).join('\n'),
      });

      if (!grounding.ok) {
        lastGroundingFailureKind = grounding.kind;
        lastObjection = grounding.failures.join('; ');
        priorDefect =
          grounding.kind === 'editor-only-leak'
            ? 'grounding validator: your text cited confidential editor-only finding ids; cite only ids present in the author-facing ledger artefact'
            : grounding.kind === 'ungrounded-id'
              ? 'grounding validator: your text cited finding ids that are superseded or unknown; cite only ids present verbatim in the author-facing ledger artefact and never ids marked [SUPERSEDED]'
              : grounding.kind === 'id-in-prose'
                ? `grounding validator: the shipped report body contains raw finding ids; the prose stays id-free and all grounding moves into evidenceMap entries. Specifically: ${redactEditorOnlyIds(lastObjection, editorOnlyIds)}`
                : grounding.kind === 'machine-token'
                  ? `grounding validator: the shipped report body contains internal machine tokens; rewrite exactly these spots as natural reviewer prose and change nothing else: ${redactEditorOnlyIds(lastObjection, editorOnlyIds)}`
                  : grounding.kind === 'evidence-map-mismatch'
                    ? `grounding validator: the evidence map does not line up with the ledger and the body: ${redactEditorOnlyIds(lastObjection, editorOnlyIds)}`
                    : `grounding validator: ${redactEditorOnlyIds(lastObjection, editorOnlyIds)}`;
        emitGateVerdict(db, reviewId, { cycle, source: 'grounding-validator', verdict: 'revise', failures: grounding.failures });
        fixCycles += 1;
        recordGateCheckpoint(db, {
          reviewId,
          phase: checkpointKey('phase_7'),
          status: 'in_progress',
          gateVerdict: 'revise',
          fixCycleCount: fixCycles,
          snapshot: { cycle, source: 'grounding-validator', failures: grounding.failures },
        });
        if (fixCycles >= MAX_FIX_CYCLES) {
          break;
        }
        continue;
      }

      lastGroundingFailureKind = null;
      const runAudit = `Fix cycles used so far: ${fixCycles}. This is gate cycle ${cycle}.`;
      const critic = await runAgent<ReviewFinalCriticOutput>(deps, {
        reviewId,
        phase: 'phase_7',
        agent: 'review-final-critic',
        artefactName: `p7-critic-${cycle}`,
        assembleInput: {
          artefacts: [
            { label: 'Full internal report (Phase 6)', content: report.bodyMarkdown },
            { label: 'Shipped seven-part report', content: shipped.bodyMarkdown },
            { label: 'Reviewer\'s private notes', content: privateNotes.markdown },
            {
              label: 'Merged evidence ledger (current findings, canonical ids)',
              content: JSON.stringify(ledgerForReport(currentAll), null, 2),
            },
            { label: 'Swarm summary', content: JSON.stringify(swarm, null, 2) },
            { label: 'Run audit facts', content: runAudit },
          ],
          routingNote:
            'Release gate. Attack the shipped report and the private notes: evidence grounding, confidentiality and signal audit, tone risk, actionability, and mechanical QA. Before conceding pass, attempt to construct one concrete failure and report the attempt. Return exactly one verdict: pass, revise, revise-specialist (naming the lens and the finding id to supersede), or block.',
        },
      });

      lastObjection = critic.mostDangerousDefect ?? critic.failureConstructionAttempt;

      emitGateVerdict(db, reviewId, { cycle, source: 'final-critic', verdict: critic.verdict, lens: critic.lens });

      if (critic.verdict === 'pass') {
        released = true;
        releaseVerdict = 'pass';
        finalRecommendation = currentMeta.recommendation;
        recordGateCheckpoint(db, {
          reviewId,
          phase: checkpointKey('phase_7'),
          status: 'in_progress',
          gateVerdict: 'pass',
          fixCycleCount: fixCycles,
          snapshot: { cycle, verdict: 'pass' },
        });
        break;
      }

      if (critic.verdict === 'block') {
        blocked = true;
        blockReason = critic.mostDangerousDefect ?? 'Release blocked at the final critic.';
        recordGateCheckpoint(db, {
          reviewId,
          phase: checkpointKey('phase_7'),
          status: 'completed',
          gateVerdict: 'block',
          fixCycleCount: fixCycles,
          snapshot: { cycle, verdict: 'block', reason: blockReason },
        });
        break;
      }

      priorDefect =
        critic.verdict === 'revise'
          ? `final critic revise on sections: ${critic.sectionsToRework.join(', ')}`
          : `final critic revise-specialist on lens ${critic.lens ?? 'unknown'}`;
      fixCycles += 1;
      recordGateCheckpoint(db, {
        reviewId,
        phase: checkpointKey('phase_7'),
        status: 'in_progress',
        gateVerdict: critic.verdict === 'revise' ? 'revise' : 'revise_specialist',
        fixCycleCount: fixCycles,
        snapshot: { cycle, verdict: critic.verdict, lens: critic.lens },
      });

      if (fixCycles >= MAX_FIX_CYCLES) {
        break;
      }

      if (critic.verdict === 'revise-specialist' && critic.lens !== null) {
        await reDispatchSpecialist(deps, reviewId, digest, critic);
        const refreshed = getCurrentFindings(db, reviewId);
        const refreshedIds = new Set(refreshed.map((finding) => finding.id));
        currentMeta = await runMetaReviewer(
          deps,
          reviewId,
          fixCycles,
          digest,
          report,
          swarm,
          refreshed,
          refreshedIds,
          options,
        );
      }
    }

    if (!released && !blocked) {
      const currentAll = getCurrentFindings(db, reviewId);
      const ledgerIdsNow = new Set(currentAll.map((finding) => finding.id));
      arbitration = arbitrate({
        objection: lastObjection,
        lastGroundingFailureKind,
        confidentialityOrVerdictObjection: false,
        recommendation: currentMeta.recommendation,
        decisionHingeIds: currentMeta.decisionHinges.map((hinge) => hinge.findingId),
        ledgerIds: ledgerIdsNow,
        openFatalIds: currentAll.filter((finding) => finding.severity === 'fatal').map((finding) => finding.id),
        openMajorIds: currentAll.filter((finding) => finding.severity === 'major').map((finding) => finding.id),
      });
      insertEvent(db, {
        reviewId,
        kind: 'arbitration',
        phase: 'phase_7',
        payload: {
          outcome: arbitration.outcome,
          objection: arbitration.objection,
          rationale: arbitration.rationale,
          evidenceIds: arbitration.evidenceIds,
          narrowedRecommendation: arbitration.narrowedRecommendation,
        },
      });
      if (arbitration.outcome === 'halt') {
        blocked = true;
        blockReason = arbitration.rationale;
      } else {
        released = true;
        releaseVerdict = 'arbitrated';
        finalRecommendation = arbitration.narrowedRecommendation ?? currentMeta.recommendation;
      }
      recordGateCheckpoint(db, {
        reviewId,
        phase: checkpointKey('phase_7'),
        status: blocked ? 'completed' : 'in_progress',
        gateVerdict: 'arbitrated',
        fixCycleCount: fixCycles,
        snapshot: { arbitration },
      });
    }

    if (
      released &&
      releaseVerdict === 'arbitrated' &&
      arbitration !== null &&
      arbitration.narrowedRecommendation !== null &&
      lastShipped !== null &&
      arbitration.narrowedRecommendation !== lastShipped.recommendation
    ) {
      const narrowed = arbitration.narrowedRecommendation;
      const alignAll = getCurrentFindings(db, reviewId);
      const alignLedgerIds = new Set(alignAll.map((finding) => finding.id));
      const alignEditorOnlyIds = new Set(
        alignAll.filter((finding) => finding.scope === 'editor_only').map((finding) => finding.id),
      );
      const alignAuthorFacing = alignAll.filter((finding) => finding.scope !== 'editor_only');
      try {
        const alignedRaw = await runAgent<ShippedReportEnvelope>(deps, {
          reviewId,
          phase: 'phase_7',
          agent: 'review-report-writer',
          mode: 'B',
          artefactName: 'p7-shipped-aligned',
          validate: (value) => {
            const envelope = value as ShippedReportEnvelope;
            if (envelope.recommendation !== narrowed) {
              throw new Error(`the arbitrated recommendation is ${narrowed}; the envelope and the report body must state it`);
            }
          },
          assembleInput: {
            mode: 'B',
            artefacts: [
              {
                label: 'Prior shipped report (recommendation superseded by arbitration)',
                content: redactSupersededIds(redactEditorOnlyIds(lastShipped.bodyMarkdown, alignEditorOnlyIds), alignLedgerIds),
              },
              {
                label: 'Author-facing ledger (cite only these ids)',
                content: JSON.stringify(ledgerForReport(alignAuthorFacing), null, 2),
              },
              { label: 'Arbitration rationale', content: arbitration.rationale },
            ],
            routingNote: `Deterministic arbitration set the recommendation to ${narrowed} with the attached rationale. Restate the prior report so its recommendation statements argue for that outcome honestly, in natural reviewer prose per the knowledge/06 register (no taxonomy tokens, no key-value lines, no finding ids in the body). Only the recommendation framing changes: keep every section heading and bold problem label byte-identical to the prior report, and return the evidenceMap unchanged (the engine preserves the validated map regardless).`,
          },
        });
        const aligned = withDerivedCitedIds({ ...alignedRaw, evidenceMap: lastShipped.evidenceMap });
        const alignedNotes = assemblePrivateNotes({
          recommendation: narrowed,
          recommendationConfidence: currentMeta.recommendationConfidence,
          currentFindings: alignAll,
          strongestMinorityReport: swarm.strongestMinorityReport,
          editorSummaryMarkdown: redactSupersededIds(currentMeta.editorSummaryMarkdown, alignLedgerIds),
        });
        const alignedGrounding = validateGrounding({
          authorFacingBody: aligned.bodyMarkdown,
          authorFacingCitedIds: aligned.citedFindingIds,
          privateNotesBody: alignedNotes.markdown,
          privateNotesReferencedIds: alignedNotes.referencedIds,
          ledgerIds: alignLedgerIds,
          editorOnlyIds: alignEditorOnlyIds,
          idFreeProse: true,
          evidenceMap: aligned.evidenceMap,
          authorFacingAncillary: aligned.rubricTable.map((row) => row.justification).join('\n'),
        });
        if (alignedGrounding.ok) {
          lastShipped = aligned;
          lastPrivateNotes = alignedNotes.markdown;
        } else {
          released = false;
          blocked = true;
          blockReason = `Arbitration narrowed the recommendation to ${narrowed} but the aligned report failed the deterministic validator: ${alignedGrounding.failures.join('; ')}`;
        }
      } catch (error) {
        if (error instanceof DispatchPauseError) {
          throw error;
        }
        released = false;
        blocked = true;
        blockReason = `Arbitration narrowed the recommendation to ${narrowed} but no schema-valid aligned report could be produced: ${error instanceof Error ? error.message : String(error)}`;
      }
      emitGateVerdict(db, reviewId, {
        cycle: fixCycles,
        source: 'arbitration-alignment',
        verdict: blocked ? 'block' : 'aligned',
        narrowedRecommendation: narrowed,
      });
    }

    if (blocked) {
      writeArtefact(reviewId, 'p7-block-summary', { reason: blockReason, fixCycles, arbitration });
      updateReview(db, reviewId, { status: 'failed', errorClass: 'release_gate_block' });
      upsertCheckpoint(db, {
        reviewId,
        phase: checkpointKey('phase_7'),
        status: 'completed',
        snapshot: { released: false, blocked: true, reason: blockReason, fixCycles, arbitration },
      });
      annotatePhase({
        'mara.critic_verdict': releaseVerdict,
        'mara.released': false,
        'mara.fix_cycles': fixCycles,
      });
      insertEvent(db, {
        reviewId,
        kind: 'run_terminal',
        phase: 'phase_7',
        payload: { released: false, reason: blockReason },
      });
      return;
    }

    finalConfidence = currentMeta.recommendationConfidence;
    updateReview(db, reviewId, {
      recommendation: finalRecommendation,
      recommendationConfidence: finalConfidence,
    });

    if (intake.userPrior !== null) {
      const priorFindings = getCurrentFindings(db, reviewId);
      const priorLedgerIds = new Set(priorFindings.map((finding) => finding.id));
      const priorEditorOnlyIds = new Set(
        priorFindings.filter((finding) => finding.scope === 'editor_only').map((finding) => finding.id),
      );
      const priorStress = await runPriorStressTest(deps, reviewId, {
        userPrior: intake.userPrior,
        digest,
        recommendationPackage: recommendationPackage(currentMeta),
        findings: priorFindings.filter((finding) => finding.scope !== 'editor_only'),
        ledgerIds: priorLedgerIds,
        editorOnlyIds: priorEditorOnlyIds,
      });
      if (priorStress !== null) {
        lastPrivateNotes = assemblePrivateNotes({
          recommendation: finalRecommendation,
          recommendationConfidence: finalConfidence,
          currentFindings: priorFindings,
          strongestMinorityReport: swarm.strongestMinorityReport,
          editorSummaryMarkdown: redactSupersededIds(currentMeta.editorSummaryMarkdown, priorLedgerIds),
          priorStressTest: {
            prior: intake.userPrior,
            caseFor: priorStress.caseFor,
            caseAgainst: priorStress.caseAgainst,
            alignment: priorStress.alignment,
          },
        }).markdown;
      }
    }

    if (lastShipped !== null) {
      writeArtefact(reviewId, 'p7-shipped-final', lastShipped);
      writeArtefact(reviewId, 'p7-private-notes-final', { markdown: lastPrivateNotes });
    }

    const gateRecord = {
      released: true,
      verdict: releaseVerdict,
      fixCycles,
      recommendation: finalRecommendation,
      recommendationConfidence: finalConfidence,
      rubricAverage: currentMeta.average,
      ...(arbitration !== null ? { arbitration } : {}),
    };
    writeArtefact(reviewId, 'p7-gate-record', gateRecord);

    annotatePhase({
      'mara.critic_verdict': releaseVerdict,
      'mara.recommendation': finalRecommendation,
      'mara.rubric_average': currentMeta.average,
      'mara.fix_cycles': fixCycles,
      'mara.released': true,
    });

    insertEvent(db, {
      reviewId,
      kind: 'phase_transition',
      phase: 'phase_7',
      payload: {
        verdict: releaseVerdict,
        fixCycles,
        recommendation: finalRecommendation,
        rubricAverage: currentMeta.average,
      },
    });
    upsertCheckpoint(db, {
      reviewId,
      phase: checkpointKey('phase_7'),
      status: 'completed',
      snapshot: {
        released: true,
        verdict: releaseVerdict,
        fixCycles,
        recommendation: finalRecommendation,
        recommendationConfidence: finalConfidence,
        rubricAverage: currentMeta.average,
      },
    });
  });
}

const PRIOR_SEVERITY_WEIGHT: Record<string, number> = { none: 0, minor: 1, moderate: 2, major: 3, fatal: 4 };

async function runPriorStressTest(
  deps: EngineDeps,
  reviewId: string,
  input: {
    userPrior: string;
    digest: string;
    recommendationPackage: Record<string, unknown>;
    findings: CurrentFinding[];
    ledgerIds: Set<string>;
    editorOnlyIds: Set<string>;
  },
): Promise<PriorStressTestOutput | null> {
  try {
    const topFindings = [...input.findings]
      .sort((a, b) => (PRIOR_SEVERITY_WEIGHT[b.severity] ?? 0) - (PRIOR_SEVERITY_WEIGHT[a.severity] ?? 0))
      .slice(0, 20)
      .map((finding) => ({
        id: finding.id,
        lens: finding.type,
        claim: finding.claim,
        anchor: finding.manuscriptAnchor,
        severity: finding.severity,
        scope: finding.scope,
        confidence: finding.confidence,
      }));
    return await runAgent<PriorStressTestOutput>(deps, {
      reviewId,
      phase: 'phase_7',
      agent: 'prior-stress-test',
      artefactName: 'p7-prior-stress',
      validate: (value) => {
        const output = value as PriorStressTestOutput;
        const ungrounded = output.hingeFindingIds.filter((id) => !input.ledgerIds.has(id));
        if (ungrounded.length > 0) {
          throw new Error(
            `prior stress test cites hinge finding ids not present in the ledger: ${ungrounded.join(', ')}. Name only current ledger ids as hinges.`,
          );
        }
      },
      assembleInput: {
        manuscriptExcerpt: input.digest,
        artefacts: [
          { label: "Reviewer's preliminary assessment (the prior under test)", content: input.userPrior },
          {
            label: 'Recommendation package (reached on the evidence)',
            content: redactEditorOnlyIds(JSON.stringify(input.recommendationPackage, null, 2), input.editorOnlyIds),
          },
          {
            label: 'Current evidence ledger (author-facing findings, canonical ids)',
            content: JSON.stringify(topFindings, null, 2),
          },
        ],
        routingNote:
          "Hold the reviewer's preliminary assessment against the assembled evidence. Build the honest case for and against it, then set alignment to supported, partially_supported, or contradicted with positive evidence. Name the hinge finding ids from the ledger above; every id must exist there verbatim. Any id shown as [EDITOR-ONLY] is confidential and never appears in your prose or hinges.",
      },
    });
  } catch (error) {
    if (error instanceof DispatchPauseError) {
      throw error;
    }
    insertEvent(deps.db, {
      reviewId,
      kind: 'error',
      phase: 'phase_7',
      payload: { message: 'Prior stress test skipped after an internal error.' },
    });
    return null;
  }
}

async function reDispatchSpecialist(
  deps: EngineDeps,
  reviewId: string,
  digest: string,
  critic: ReviewFinalCriticOutput,
): Promise<void> {
  const lens = matchLens(critic.lens ?? '');
  if (lens === undefined) {
    return;
  }
  const current = getCurrentFindings(deps.db, reviewId);
  const mine = current.filter((finding) => finding.id.startsWith(`REV-${lens.prefix}-`));
  const result = await runAgent<SpecialistReviewerOutput>(deps, {
    reviewId,
    phase: 'phase_7',
    agent: 'specialist-reviewer',
    artefactName: `p7-respecialist-${lens.prefix}`,
    assembleInput: {
      lens: lens.display,
      manuscriptExcerpt: digest,
      artefacts: [
        { label: 'Your prior findings (canonical ledger ids)', content: JSON.stringify(mine, null, 2) },
        {
          label: 'Final-critic objection',
          content: `${critic.mostDangerousDefect ?? ''}\nFinding to supersede: ${critic.findingIdToSupersede ?? 'none'}`,
        },
      ],
      routingNote: `Targeted re-dispatch for ${lens.display} (REV-${lens.prefix}). The final critic judged a finding defective, not merely badly reported. In "findings" return only the corrected or new findings; an update sets supersedes to the existing canonical id ${critic.findingIdToSupersede ?? '(named in the objection)'}. challengeRound may be null.`,
    },
  });
  const knownIds = new Set(getCurrentFindings(deps.db, reviewId).map((finding) => finding.id));
  const sanitised = result.findings.map((finding) =>
    finding.supersedes !== null && !knownIds.has(finding.supersedes) ? { ...finding, supersedes: null } : finding,
  );
  if (sanitised.length > 0) {
    mergeFindingsOnce(deps.db, {
      reviewId,
      lensPrefix: lens.prefix,
      phase: 'phase_7',
      agent: 'specialist-reviewer',
      fragments: sanitised,
      marker: `p7-respecialist-${lens.prefix}`,
    });
  }
}
