import type { PriorStressTestOutput, ShippedReportEnvelope } from '@mara/shared';
import type { MaraDatabase } from '../db/client';
import { artefactExists, readArtefact } from '../engine/artefacts';
import { redactEditorOnlyIds } from '../engine/grounding';
import { PREFIX_DISPLAY } from '../engine/lenses';
import { readIntakeOptions } from '../engine/options';
import { getCurrentFindings } from '../ledger';
import { getReviewOptions } from '../workflow/repo';
import { requireReview } from './reviews';

const FINDING_ID_PATTERN = /^REV-([A-Z]{3,4})-\d{4}$/;

export interface EvidenceFinding {
  id: string;
  lensPrefix: string;
  lensDisplay: string;
  severity: string;
  anchor: string;
  claim: string;
  recommendedAction: string | null;
}

export interface EvidenceMapView {
  section: string;
  label: string;
  anchor: string;
  findingIds: string[];
}

export interface PriorStressTestView {
  prior: string;
  caseFor: string;
  caseAgainst: string;
  alignment: PriorStressTestOutput['alignment'];
  hingeFindingIds: string[];
}

export interface EvidenceData {
  evidenceMap: EvidenceMapView[];
  findings: EvidenceFinding[];
  priorStressTest: PriorStressTestView | null;
}

function lensPrefixOf(id: string): string {
  const match = FINDING_ID_PATTERN.exec(id);
  return match !== null ? (match[1] as string) : '';
}

export function getEvidenceData(db: MaraDatabase, reviewId: string): EvidenceData {
  requireReview(db, reviewId);

  const all = getCurrentFindings(db, reviewId);
  const served = all.filter((finding) => finding.scope !== 'editor_only');
  const servedIds = new Set(served.map((finding) => finding.id));
  const editorOnlyIds = new Set(all.filter((finding) => finding.scope === 'editor_only').map((finding) => finding.id));

  const findings: EvidenceFinding[] = served.map((finding) => {
    const lensPrefix = lensPrefixOf(finding.id);
    return {
      id: finding.id,
      lensPrefix,
      lensDisplay: PREFIX_DISPLAY[lensPrefix] ?? 'Review',
      severity: finding.severity,
      anchor: finding.manuscriptAnchor,
      claim: finding.claim,
      recommendedAction: finding.recommendedAction,
    };
  });

  let evidenceMap: EvidenceMapView[] = [];
  if (artefactExists(reviewId, 'p7-shipped-final')) {
    const shipped = readArtefact<ShippedReportEnvelope>(reviewId, 'p7-shipped-final');
    evidenceMap = shipped.evidenceMap
      .map((entry) => ({
        section: entry.section,
        label: entry.label,
        anchor: entry.anchor,
        findingIds: entry.findingIds.filter((id) => servedIds.has(id)),
      }))
      .filter((entry) => entry.findingIds.length > 0);
  }

  let priorStressTest: PriorStressTestView | null = null;
  if (artefactExists(reviewId, 'p7-prior-stress')) {
    const userPrior = readIntakeOptions(getReviewOptions(db, reviewId)).userPrior;
    if (userPrior !== null) {
      const stress = readArtefact<PriorStressTestOutput>(reviewId, 'p7-prior-stress');
      priorStressTest = {
        prior: userPrior,
        caseFor: redactEditorOnlyIds(stress.caseFor, editorOnlyIds),
        caseAgainst: redactEditorOnlyIds(stress.caseAgainst, editorOnlyIds),
        alignment: stress.alignment,
        hingeFindingIds: stress.hingeFindingIds.filter((id) => servedIds.has(id)),
      };
    }
  }

  return { evidenceMap, findings, priorStressTest };
}
