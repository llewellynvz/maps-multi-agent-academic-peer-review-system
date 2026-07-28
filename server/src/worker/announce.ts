import { sql } from 'drizzle-orm';
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
  const authorFacing = finding.scope === 'author_facing' || finding.scope === 'both';
  if (!authorFacing) {
    return {
      findingId: finding.id,
      severity: finding.severity,
      scope: finding.scope,
      lensPrefix: '',
      lensDisplay: 'Confidential',
      headline: 'Confidential signal recorded',
    };
  }
  const lensPrefix = lensPrefixOf(finding.id);
  const lensDisplay = PREFIX_DISPLAY[lensPrefix] ?? 'Review';
  return {
    findingId: finding.id,
    severity: finding.severity,
    scope: finding.scope,
    lensPrefix,
    lensDisplay,
    headline: `${lensDisplay} recorded a ${finding.severity} issue`,
  };
}

// A resume starts a fresh in-memory set, so without seeding it from what the review has already
// emitted every prior finding is announced again and the client's headline stream shows duplicates.
export function announcedFindingIds(db: MaraDatabase, reviewId: string): Set<string> {
  const rows = db.all<{ payload_json: string }>(
    sql`SELECT payload_json FROM review_events WHERE review_id = ${reviewId} AND kind = 'finding_recorded'`,
  );
  const ids = new Set<string>();
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json) as { findingId?: unknown };
      if (typeof payload.findingId === 'string') {
        ids.add(payload.findingId);
      }
    } catch {
      continue;
    }
  }
  return ids;
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
