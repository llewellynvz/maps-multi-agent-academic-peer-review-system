import type { MaraDatabase } from '../db/client';
import { type DetectDispatch, type InjectionVerdict, sanitizeManuscript, type SanitizeResult } from '../sanitize';
import { mergeFindings } from '../ledger';
import { insertEvent, updateManuscript, updateReview } from './repo';
import { writeManuscriptBlob } from './storage';

export interface SanitizePhaseOptions {
  db: MaraDatabase;
  reviewId: string;
  text: string;
  runDispatch: DetectDispatch;
  detect?: (options: {
    text: string;
    runDispatch: DetectDispatch;
    reviewId: string;
  }) => Promise<InjectionVerdict & { degraded?: boolean }>;
}

// knowledge/01, Tier 2: quarantine, never execute, and record an editor-only finding naming what was found
// and where, in signal language. The quoted text itself stays out of the ledger: every later agent reads
// the ledger, so repeating the injection there would hand it straight back to the reviewers.
function recordQuarantineSignal(db: MaraDatabase, reviewId: string, result: SanitizeResult): void {
  const quarantined = result.quarantineLog.filter((item) => item.tier >= 2);
  if (quarantined.length === 0) {
    return;
  }
  const ids = quarantined.map((item) => item.id).join(', ');
  const kinds = [...new Set(quarantined.map((item) => item.patternId ?? 'detector-flagged'))].join(', ');
  mergeFindings(db, {
    reviewId,
    lensPrefix: 'SAN',
    phase: 'phase_0',
    agent: 'manuscript-sanitizer',
    marker: 'p0-sanitize-signal',
    fragments: [
      {
        id: 'REV-SAN-0001',
        lens: 'Manuscript screening',
        phase: 0,
        claim: `Instructional text addressed to an automated reviewer was found in the manuscript and quarantined (${quarantined.length} passage${quarantined.length === 1 ? '' : 's'}: ${kinds}). This is a signal that may warrant editorial review, not a determination of misconduct.`,
        anchor: `Quarantine log ${ids}`,
        epistemic: 'Known',
        confidence: 0.9,
        band: 'Yellow',
        severity: 'moderate',
        fixability: 'easy',
        scope: 'editor-only',
        failureScenario: 'Left in place, the passage could steer an automated review toward a favourable or incomplete assessment.',
        leanestFix: 'The editor inspects the quarantined passages in the original file and decides whether to query the authors.',
        supersedes: null,
      },
    ],
  });
}

export async function sanitizePhase(options: SanitizePhaseOptions): Promise<SanitizeResult> {
  const result = await sanitizeManuscript({
    text: options.text,
    runDispatch: options.runDispatch,
    reviewId: options.reviewId,
    ...(options.detect !== undefined ? { detect: options.detect } : {}),
  });

  writeManuscriptBlob(options.reviewId, 'manuscript/sanitized.txt', result.sanitizedText);
  updateManuscript(options.db, options.reviewId, {
    sanitizedText: result.sanitizedText,
    quarantineTier: result.tier === 0 ? null : result.tier,
    quarantineLogJson: JSON.stringify(result.quarantineLog),
    sanitizedAt: new Date().toISOString(),
  });

  if (result.detectorDegraded) {
    insertEvent(options.db, {
      reviewId: options.reviewId,
      kind: 'error',
      phase: 'phase_0',
      payload: { step: 'sanitize', detector: 'pipe25_unavailable', rationale: result.detectorRationale },
    });
  }

  if (result.halted) {
    insertEvent(options.db, {
      reviewId: options.reviewId,
      kind: 'run_terminal',
      phase: 'phase_0',
      payload: {
        outcome: 'failed',
        errorClass: 'tier_3_tampering',
        reason: 'tier_3_tampering',
        tier: result.tier,
        spans: result.quarantineLog.length,
      },
    });
    updateReview(options.db, options.reviewId, { status: 'failed', errorClass: 'tier_3_tampering' });
  } else if (result.status === 'quarantined') {
    insertEvent(options.db, {
      reviewId: options.reviewId,
      kind: 'phase_transition',
      phase: 'phase_0',
      payload: { quarantined: true, tier: result.tier, spanCount: result.quarantineLog.length },
    });
    recordQuarantineSignal(options.db, options.reviewId, result);
  }

  return result;
}
