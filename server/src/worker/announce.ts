import type { MaraDatabase } from '../db/client';
import { getCurrentFindings } from '../ledger';
import { insertEvent } from '../workflow/repo';

export interface FindingHeadline {
  findingId: string;
  severity: string;
  scope: string;
  headline: string;
}

export function findingHeadline(finding: {
  id: string;
  type: string;
  severity: string;
  scope: string;
}): FindingHeadline {
  const authorFacing = finding.scope === 'author_facing' || finding.scope === 'both';
  const label = authorFacing
    ? `${finding.severity} ${finding.type} finding`.trim()
    : 'Confidential signal recorded';
  return { findingId: finding.id, severity: finding.severity, scope: finding.scope, headline: label };
}

export function announceFindings(db: MaraDatabase, reviewId: string, announced: Set<string>): void {
  for (const finding of getCurrentFindings(db, reviewId)) {
    if (announced.has(finding.id)) {
      continue;
    }
    announced.add(finding.id);
    insertEvent(db, {
      reviewId,
      kind: 'finding_recorded',
      phase: finding.phase,
      payload: findingHeadline(finding),
    });
  }
}
