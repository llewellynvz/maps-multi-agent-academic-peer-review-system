import type { MaraDatabase } from '../db/client';
import { PREFIX_DISPLAY } from '../engine/lenses';
import { getCurrentFindings } from '../ledger';
import { insertEvent } from '../workflow/repo';

export interface FindingHeadline {
  findingId: string;
  severity: string;
  scope: string;
  lensPrefix: string;
  lensDisplay: string;
  headline: string;
}

function lensPrefixOf(findingId: string): string {
  const parts = findingId.split('-');
  const candidate = parts.length >= 3 ? parts[1] : parts[0];
  return (candidate ?? '').toUpperCase();
}

export function findingHeadline(finding: {
  id: string;
  type: string;
  severity: string;
  scope: string;
}): FindingHeadline {
  const lensPrefix = lensPrefixOf(finding.id);
  const lensDisplay = PREFIX_DISPLAY[lensPrefix] ?? 'Review';
  const authorFacing = finding.scope === 'author_facing' || finding.scope === 'both';
  const headline = authorFacing
    ? `${lensDisplay} recorded a ${finding.severity} issue`
    : 'Confidential signal recorded';
  return { findingId: finding.id, severity: finding.severity, scope: finding.scope, lensPrefix, lensDisplay, headline };
}

export function announceFindings(db: MaraDatabase, reviewId: string, announced: Set<string>): void {
  for (const finding of getCurrentFindings(db, reviewId)) {
    if (announced.has(finding.id)) {
      continue;
    }
    announced.add(finding.id);
    if (finding.severity === 'none') {
      continue;
    }
    insertEvent(db, {
      reviewId,
      kind: 'finding_recorded',
      phase: finding.phase,
      payload: findingHeadline(finding),
    });
  }
}
