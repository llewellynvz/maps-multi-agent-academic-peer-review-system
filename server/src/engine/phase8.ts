import { eq } from 'drizzle-orm';
import type {
  ClaimDesignAnalysis,
  FullReportEnvelope,
  JournalScopeScorerOutput,
  QualityMetricsEngineOutput,
  Recommendation,
  ReviewCalibratorOutput,
  ReviewMetaReviewerOutput,
  ShippedReportEnvelope,
  SwarmEvaluation,
} from '@mara/shared';
import { getCurrentFindings } from '../ledger';
import { reviews } from '../db/schema';
import { annotatePhase, withPhase } from '../tracing';
import {
  getCheckpoint,
  getReviewOptions,
  insertEvent,
  updateReview,
  upsertCheckpoint,
} from '../workflow/repo';
import { readArtefact, writeArtefact } from './artefacts';
import { loadEngineContext } from './context';
import { persistDeliverable } from './deliverables';
import { runAgent } from './dispatch-agent';
import { renderDeliverableDocx, type DeliverableMetadataRow } from './docx';
import { appendRunAudit } from './private-notes';
import { writeManuscriptBlob } from '../workflow/storage';
import type { EngineDeps } from './phases-shared';

const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  accept: 'Accept',
  minor_revision: 'Minor revision',
  major_revision: 'Major revision',
  reject_and_resubmit: 'Reject and resubmit',
  reject: 'Reject',
};

function checkpointKey(phase: string): string {
  return `engine_${phase}`;
}

function journalName(options: Record<string, unknown>): string | null {
  const answers = (options.answers ?? {}) as Record<string, unknown>;
  return typeof answers.journal === 'string' ? answers.journal : null;
}

function ledgerSnapshotMarkdown(reviewId: string, findings: ReturnType<typeof getCurrentFindings>): string {
  const lines = ['# Evidence ledger snapshot', '', `Review ${reviewId}. Current findings: ${findings.length}.`, ''];
  lines.push('| Finding | Lens | Severity | Scope | Anchor |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const finding of findings) {
    lines.push(`| ${finding.id} | ${finding.type} | ${finding.severity} | ${finding.scope} | ${finding.manuscriptAnchor.replace(/\|/g, '/')} |`);
  }
  return `${lines.join('\n')}\n`;
}

function runAuditText(gateRecord: Record<string, unknown>): string {
  const fixCycles = typeof gateRecord.fixCycles === 'number' ? gateRecord.fixCycles : 0;
  const verdict = typeof gateRecord.verdict === 'string' ? gateRecord.verdict : 'pass';
  const lines = [`Release verdict: ${verdict}. Fix cycles used: ${fixCycles} of 2.`];
  const arbitration = gateRecord.arbitration as Record<string, unknown> | undefined;
  if (arbitration !== undefined) {
    lines.push(`Arbitration outcome: ${String(arbitration.outcome)}. ${String(arbitration.rationale)}`);
  }
  return lines.join('\n');
}

function completedReviewsForJournal(deps: EngineDeps, journal: string | null, selfReviewId: string): number {
  if (journal === null) {
    return 0;
  }
  const rows = deps.db.select().from(reviews).where(eq(reviews.status, 'completed')).all();
  let count = 0;
  for (const row of rows) {
    if (row.id === selfReviewId) {
      continue;
    }
    try {
      const options = JSON.parse(row.optionsJson) as Record<string, unknown>;
      const answers = (options.answers ?? {}) as Record<string, unknown>;
      if (typeof answers.journal === 'string' && answers.journal === journal) {
        count += 1;
      }
    } catch {
      continue;
    }
  }
  return count;
}

export async function runPhase8(deps: EngineDeps, reviewId: string): Promise<void> {
  const { db } = deps;
  if (getCheckpoint(db, reviewId, checkpointKey('phase_8'))?.status === 'completed') {
    return;
  }
  const phase7 = getCheckpoint(db, reviewId, checkpointKey('phase_7'));
  const snapshot = (phase7?.snapshot ?? {}) as Record<string, unknown>;
  const released = snapshot.released === true;

  const ctx = loadEngineContext(db, reviewId);
  const options = getReviewOptions(db, reviewId);
  const fullReport = readArtefact<FullReportEnvelope>(reviewId, 'p6-report');
  const swarm = readArtefact<SwarmEvaluation>(reviewId, 'p5-swarm');
  const meta = readArtefact<ReviewMetaReviewerOutput>(reviewId, 'p7-meta-final');

  await withPhase('phase_8', async () => {
    updateReview(db, reviewId, { status: 'running', currentPhase: 'phase_8' });
    const findings = getCurrentFindings(db, reviewId);

    if (released) {
      const shipped = readArtefact<ShippedReportEnvelope>(reviewId, 'p7-shipped-final');
      const privateNotes = readArtefact<{ markdown: string }>(reviewId, 'p7-private-notes-final');
      const gateRecord = readArtefact<Record<string, unknown>>(reviewId, 'p7-gate-record');
      const recommendation = (typeof gateRecord.recommendation === 'string'
        ? gateRecord.recommendation
        : shipped.recommendation) as Recommendation;
      const confidence = typeof gateRecord.recommendationConfidence === 'number'
        ? gateRecord.recommendationConfidence
        : shipped.recommendationConfidence;
      const nowDate = new Date().toISOString().slice(0, 10);

      const reportMeta: DeliverableMetadataRow[] = [
        { label: 'Review', value: reviewId, mono: true },
        { label: 'Recommendation', value: RECOMMENDATION_LABEL[recommendation], mono: false },
        { label: 'Confidence', value: confidence.toFixed(2), mono: true },
        { label: 'Rubric average', value: (typeof gateRecord.rubricAverage === 'number' ? gateRecord.rubricAverage : meta.average).toFixed(1), mono: true },
        { label: 'Date', value: nowDate, mono: true },
      ];
      const reportDocx = await renderDeliverableDocx({
        title: 'Peer review report',
        kicker: 'Peer review',
        subtitle: `${RECOMMENDATION_LABEL[recommendation]} at confidence ${confidence.toFixed(2)}.`,
        metadata: reportMeta,
        bodyMarkdown: shipped.bodyMarkdown,
        confidential: false,
      });

      const privateNotesBody = appendRunAudit(privateNotes.markdown, runAuditText(gateRecord));
      const notesDocx = await renderDeliverableDocx({
        title: 'Reviewer\'s private notes',
        kicker: 'Editor-only',
        subtitle: 'Editorial signals and run audit for the handling editor.',
        metadata: [
          { label: 'Review', value: reviewId, mono: true },
          { label: 'Recommendation', value: RECOMMENDATION_LABEL[recommendation], mono: false },
        ],
        bodyMarkdown: privateNotesBody,
        confidential: true,
      });

      persistDeliverable(db, {
        reviewId,
        kind: 'peer_review_report',
        format: 'docx',
        relativePath: 'output/author-letter.docx',
        bytes: reportDocx,
        released: true,
      });
      persistDeliverable(db, {
        reviewId,
        kind: 'peer_review_report',
        format: 'md',
        relativePath: 'output/author-letter.md',
        bytes: Buffer.from(shipped.bodyMarkdown, 'utf8'),
        released: true,
      });
      persistDeliverable(db, {
        reviewId,
        kind: 'reviewer_private_notes',
        format: 'docx',
        relativePath: 'output/reviewer-private-notes.docx',
        bytes: notesDocx,
        released: true,
      });
      persistDeliverable(db, {
        reviewId,
        kind: 'reviewer_private_notes',
        format: 'md',
        relativePath: 'output/reviewer-private-notes.md',
        bytes: Buffer.from(privateNotesBody, 'utf8'),
        released: true,
      });

      const ledgerSnapshot = ledgerSnapshotMarkdown(reviewId, findings);
      persistDeliverable(db, {
        reviewId,
        kind: 'ledger_export',
        format: 'md',
        relativePath: 'output/ledger-snapshot.md',
        bytes: Buffer.from(ledgerSnapshot, 'utf8'),
        released: true,
      });

      writeManuscriptBlob(reviewId, 'report/full-report.md', fullReport.bodyMarkdown);

      insertEvent(db, {
        reviewId,
        kind: 'deliverable_released',
        phase: 'phase_8',
        payload: { kinds: ['peer_review_report', 'reviewer_private_notes', 'ledger_export'] },
      });
    }

    const ledgerForJudges = JSON.stringify(
      findings.map((finding) => ({
        id: finding.id,
        lens: finding.type,
        severity: finding.severity,
        scope: finding.scope,
        leanestFix: finding.recommendedAction,
      })),
      null,
      2,
    );

    const shippedBody = released
      ? readArtefact<ShippedReportEnvelope>(reviewId, 'p7-shipped-final').bodyMarkdown
      : fullReport.bodyMarkdown;
    const analystB = readArtefact<ClaimDesignAnalysis>(reviewId, 'p1-analyst-b');
    const journal = journalName(options);
    const journalCount = completedReviewsForJournal(deps, journal, reviewId);

    const [metrics, scope, calibration] = await Promise.all([
      runAgent<QualityMetricsEngineOutput>(deps, {
        reviewId,
        phase: 'phase_8',
        agent: 'quality-metrics-engine',
        artefactName: 'p8-quality-metrics',
        assembleInput: {
          artefacts: [
            { label: 'Merged evidence ledger', content: ledgerForJudges },
            { label: 'Shipped report', content: shippedBody },
            { label: 'Full internal report', content: fullReport.bodyMarkdown },
            { label: 'Swarm summary (decision stability is authoritative here)', content: JSON.stringify(swarm, null, 2) },
            { label: 'Gate record', content: JSON.stringify(snapshot, null, 2) },
          ],
          routingNote: `Compute the composite. Carry decisionStability directly from the swarm summary (${swarm.decisionStability}). Use the exact fixed weights: evidenceGroundingRate 0.3, actionabilityIndex 0.25, decisionStability 0.2, toneRiskScore 0.15, unsupportedClaimPenalty 0.1, and return them unchanged in the weights object.`,
        },
      }),
      runAgent<JournalScopeScorerOutput>(deps, {
        reviewId,
        phase: 'phase_8',
        agent: 'journal-scope-scorer',
        artefactName: 'p8-journal-scope',
        assembleInput: {
          artefacts: [
            { label: 'Journal scope material', content: journal ?? 'No journal scope text supplied.' },
            {
              label: 'Manuscript card',
              content: `Title: ${ctx.sectionMap.title ?? 'not extracted'}. Study design: ${analystB.studyDesign}.`,
            },
          ],
          routingNote: `Score scope fit using legitimate factors only. The journal scope text is ${journal !== null ? 'a name only, not full aims' : 'unavailable'}; set scopeTextAvailable accordingly and lower confidence rather than the score when it is thin.`,
        },
      }),
      runAgent<ReviewCalibratorOutput>(deps, {
        reviewId,
        phase: 'phase_8',
        agent: 'review-calibrator',
        artefactName: 'p8-calibration',
        assembleInput: {
          artefacts: [
            { label: 'Shipped report', content: shippedBody },
            { label: 'Editor decision', content: 'Not available for this run.' },
            { label: 'Calibration benchmarks', content: 'Cross-journal peer-review and LLM-review benchmarks only.' },
          ],
          routingNote: `completedReviewsForJournal is exactly ${journalCount}. Set journalSpecificThresholdMet to (${journalCount} >= 10) and mode to journal-specific only when that is true, otherwise cross-journal-fallback labelled as not journal-specific.`,
        },
      }),
    ]);

    insertEvent(db, {
      reviewId,
      kind: 'phase_transition',
      phase: 'phase_8',
      payload: {
        released,
        composite: metrics.composite,
        scopeFit: scope.score,
        calibrationMode: calibration.mode,
      },
    });

    const lessons = {
      reviewId,
      recommendation: released ? meta.recommendation : null,
      rubricAverage: meta.average,
      composite: metrics.composite,
      decisionStability: swarm.decisionStability,
      scopeFit: scope.score,
      calibrationMode: calibration.mode,
      bottlenecks: meta.bottlenecks,
      note: 'Cross-review lessons: no lessons table in the schema; persisted as an artefact for later import.',
      recordedAt: new Date().toISOString(),
    };
    writeArtefact(reviewId, 'p8-memory-lessons', lessons);
    writeManuscriptBlob(reviewId, 'memory/lessons.json', JSON.stringify(lessons, null, 2));

    annotatePhase({
      'mara.composite': metrics.composite,
      'mara.scope_fit': scope.score,
      'mara.calibration_mode': calibration.mode,
      'mara.recommendation': released ? meta.recommendation : 'not-released',
    });

    if (released) {
      updateReview(db, reviewId, { status: 'completed', completedAt: new Date().toISOString() });
    }

    upsertCheckpoint(db, {
      reviewId,
      phase: checkpointKey('phase_8'),
      status: 'completed',
      snapshot: {
        released,
        composite: metrics.composite,
        scopeFit: scope.score,
        calibrationMode: calibration.mode,
      },
    });
  });
}
