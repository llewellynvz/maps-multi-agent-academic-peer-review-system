import type { MaraDatabase } from '../db/client';
import { type DetectDispatch, type InjectionVerdict, sanitizeManuscript, type SanitizeResult } from '../sanitize';
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
      payload: { reason: 'tier_3_tampering', tier: result.tier, spans: result.quarantineLog.length },
    });
    updateReview(options.db, options.reviewId, { status: 'failed', errorClass: 'tier_3_tampering' });
  } else if (result.status === 'quarantined') {
    insertEvent(options.db, {
      reviewId: options.reviewId,
      kind: 'phase_transition',
      phase: 'phase_0',
      payload: { quarantined: true, tier: result.tier, spanCount: result.quarantineLog.length },
    });
  }

  return result;
}
