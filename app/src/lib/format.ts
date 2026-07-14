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
