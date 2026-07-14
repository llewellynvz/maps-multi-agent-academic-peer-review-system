import type { ReviewStatus } from './api';

export const PHASES: Array<{ key: string; label: string; optional: boolean }> = [
  { key: 'phase_0', label: 'Intake and sanitisation', optional: false },
  { key: 'phase_1', label: 'Manuscript analysis', optional: false },
  { key: 'phase_2', label: 'Domain context', optional: true },
  { key: 'phase_3', label: 'Specialist review', optional: false },
  { key: 'phase_4', label: 'Integrity screening', optional: true },
  { key: 'phase_5', label: 'Swarm evaluation', optional: true },
  { key: 'phase_6', label: 'Report construction', optional: false },
  { key: 'phase_7', label: 'Synthesis and the release gate', optional: false },
  { key: 'phase_8', label: 'Production and close-out', optional: false },
];

export const PHASE_DESCRIPTIONS: Record<string, string> = {
  phase_0: 'The manuscript is screened for hidden instructions and prepared for review.',
  phase_1: 'The manuscript is broken down into its structure, claims, and study design.',
  phase_2: 'Field context and comparable published work are gathered.',
  phase_3: 'Specialist reviewers examine the manuscript, each through one lens.',
  phase_4: 'The manuscript is screened for integrity signals such as reporting gaps and similarity.',
  phase_5: 'A simulated reviewer ensemble stress-tests which findings hold up.',
  phase_6: 'The findings are assembled into a full internal review report.',
  phase_7: 'The report is synthesised, scored, and checked at the release gate.',
  phase_8: 'The author letter and editor summary are produced and the review is closed.',
};

export function phaseLabel(key: string | null): string {
  return PHASES.find((phase) => phase.key === key)?.label ?? 'Intake';
}

export function phaseIndex(key: string | null): number {
  const match = /phase_(\d)/.exec(key ?? '');
  return match !== null ? Number.parseInt(match[1] ?? '0', 10) : 0;
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) {
    return 'n/a';
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export const RECOMMENDATION_LABEL: Record<string, string> = {
  accept: 'Accept',
  minor_revision: 'Minor revision',
  major_revision: 'Major revision',
  reject_and_resubmit: 'Reject and resubmit',
  reject: 'Reject',
};

export const RECOMMENDATION_EXPLANATION: Record<string, string> = {
  accept: 'The manuscript is ready to publish with no further changes.',
  minor_revision: 'The manuscript needs small changes that do not require another full review.',
  major_revision: 'The manuscript needs substantial changes and another round of review.',
  reject_and_resubmit: 'The manuscript is not acceptable now but could return as a new submission after major rework.',
  reject: 'The manuscript is not suitable for this journal.',
};

export function confidenceBandPhrase(confidence: number | null): string {
  if (confidence === null) {
    return 'not yet rated';
  }
  if (confidence >= 0.9) {
    return 'high confidence';
  }
  if (confidence >= 0.7) {
    return 'reasonable confidence';
  }
  return 'with reservations';
}

export function confidenceSentence(confidence: number | null): string {
  if (confidence === null) {
    return 'Confidence in this recommendation is not yet rated.';
  }
  if (confidence < 0.7) {
    return 'This recommendation is offered with reservations.';
  }
  return `This recommendation is made with ${confidenceBandPhrase(confidence)}.`;
}

export function hasFindingIds(text: string): boolean {
  return /REV-[A-Z]{3,4}-\d{4}/.test(text);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 KB';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export type StatusTone = 'info' | 'success' | 'warn' | 'fail' | 'neutral';

export function statusTone(status: ReviewStatus): { tone: StatusTone; label: string } {
  switch (status) {
    case 'completed':
      return { tone: 'info', label: 'Complete' };
    case 'running':
    case 'sanitizing':
      return { tone: 'info', label: 'Running' };
    case 'failed':
      return { tone: 'fail', label: 'Failed' };
    case 'paused':
    case 'awaiting_input':
      return { tone: 'warn', label: status === 'paused' ? 'Paused' : 'Awaiting input' };
    case 'queued':
      return { tone: 'neutral', label: 'Queued' };
    case 'cancelled':
      return { tone: 'neutral', label: 'Cancelled' };
    default:
      return { tone: 'neutral', label: 'Created' };
  }
}

export function confidenceBand(confidence: number | null): { tone: StatusTone; label: string } {
  if (confidence === null) {
    return { tone: 'neutral', label: 'Unrated' };
  }
  if (confidence >= 0.98) {
    return { tone: 'success', label: 'Green' };
  }
  if (confidence >= 0.7) {
    return { tone: 'warn', label: 'Yellow' };
  }
  return { tone: 'fail', label: 'Red' };
}
