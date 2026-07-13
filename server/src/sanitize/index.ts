import { detectInjection, type DetectDispatch, type InjectionVerdict } from './detector';
import { screenText, type QuarantineTier } from './patterns';

export type SanitizeStatus = 'clean' | 'quarantined' | 'halted';

export interface QuarantineItem {
  id: string;
  tier: QuarantineTier;
  source: 'pattern' | 'llm';
  patternId: string | null;
  matchText: string;
  start: number | null;
  end: number | null;
  reason: string;
}

export interface SanitizeResult {
  tier: 0 | 1 | 2 | 3;
  status: SanitizeStatus;
  halted: boolean;
  sanitizedText: string;
  quarantineLog: QuarantineItem[];
  detectorRationale: string;
}

export interface SanitizeOptions {
  text: string;
  runDispatch: DetectDispatch;
  reviewId: string;
  phase?: string;
  agent?: string;
  promptVersion?: string;
  detect?: (options: {
    text: string;
    runDispatch: DetectDispatch;
    reviewId: string;
  }) => Promise<InjectionVerdict>;
  maxChars?: number;
}

function itemId(sequence: number): string {
  return `REV-SAN-${String(sequence).padStart(4, '0')}`;
}

function statusForTier(tier: 0 | 1 | 2 | 3): SanitizeStatus {
  if (tier === 3) {
    return 'halted';
  }
  if (tier === 2) {
    return 'quarantined';
  }
  return 'clean';
}

function quarantineSpans(text: string, items: QuarantineItem[]): string {
  const ranges = items
    .filter((item) => item.tier >= 2 && item.start !== null && item.end !== null && item.end > item.start)
    .map((item) => ({ start: item.start as number, end: item.end as number, id: item.id }))
    .sort((a, b) => a.start - b.start);

  const merged: typeof ranges = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last === undefined || range.start >= last.end) {
      merged.push(range);
    }
  }

  let result = text;
  for (const range of merged.sort((a, b) => b.start - a.start)) {
    result = `${result.slice(0, range.start)}[[QUARANTINED:${range.id}]]${result.slice(range.end)}`;
  }
  return result;
}

export async function sanitizeManuscript(options: SanitizeOptions): Promise<SanitizeResult> {
  const patternMatches = screenText(options.text);
  const detect = options.detect ?? detectInjection;
  const verdict = await detect({
    text: options.text,
    runDispatch: options.runDispatch,
    reviewId: options.reviewId,
    ...(options.phase !== undefined ? { phase: options.phase } : {}),
    ...(options.agent !== undefined ? { agent: options.agent } : {}),
    ...(options.promptVersion !== undefined ? { promptVersion: options.promptVersion } : {}),
    ...(options.maxChars !== undefined ? { maxChars: options.maxChars } : {}),
  });

  const quarantineLog: QuarantineItem[] = [];
  let sequence = 1;

  for (const match of patternMatches) {
    quarantineLog.push({
      id: itemId(sequence),
      tier: match.tier,
      source: 'pattern',
      patternId: match.patternId,
      matchText: match.matchText,
      start: match.start,
      end: match.end,
      reason: match.description,
    });
    sequence += 1;
  }

  const verdictTier = Math.max(0, Math.min(3, verdict.tier)) as 0 | 1 | 2 | 3;
  if (verdictTier >= 1) {
    if (verdict.spans.length === 0) {
      quarantineLog.push({
        id: itemId(sequence),
        tier: (verdictTier === 0 ? 1 : verdictTier) as QuarantineTier,
        source: 'llm',
        patternId: null,
        matchText: '',
        start: null,
        end: null,
        reason: verdict.rationale,
      });
      sequence += 1;
    } else {
      for (const span of verdict.spans) {
        const start = options.text.indexOf(span.text);
        quarantineLog.push({
          id: itemId(sequence),
          tier: verdictTier as QuarantineTier,
          source: 'llm',
          patternId: null,
          matchText: span.text,
          start: start >= 0 ? start : null,
          end: start >= 0 ? start + span.text.length : null,
          reason: span.reason,
        });
        sequence += 1;
      }
    }
  }

  const highestTier = quarantineLog.reduce<0 | 1 | 2 | 3>(
    (max, item) => (item.tier > max ? item.tier : max),
    0,
  );

  const status = statusForTier(highestTier);
  const sanitizedText = highestTier >= 2 ? quarantineSpans(options.text, quarantineLog) : options.text;

  return {
    tier: highestTier,
    status,
    halted: status === 'halted',
    sanitizedText,
    quarantineLog,
    detectorRationale: verdict.rationale,
  };
}

export {
  detectInjection,
  type DetectDispatch,
  type DetectInjectionOptions,
  injectionVerdictSchema,
  type InjectionVerdict,
} from './detector';
export {
  injectionPatterns,
  type InjectionPattern,
  type PatternMatch,
  type QuarantineTier,
  screenText,
} from './patterns';
