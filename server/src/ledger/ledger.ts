import { sql } from 'drizzle-orm';
import { type Finding, findingSchema } from '@mara/shared';
import type { MaraDatabase } from '../db/client';
import { findings } from '../db/schema';

const FIXABILITY_TO_DB: Record<Finding['fixability'], string> = {
  easy: 'easy',
  moderate: 'moderate',
  hard: 'hard',
  'not-fixable-from-current-study': 'not_fixable_from_current_study',
  unclear: 'unclear',
};

const SCOPE_TO_DB: Record<Finding['scope'], string> = {
  'author-facing': 'author_facing',
  'editor-only': 'editor_only',
  both: 'both',
};

const PREFIX_PATTERN = /^[A-Z]{3,4}$/;

export interface MergeFindingsInput {
  reviewId: string;
  lensPrefix: string;
  phase: string;
  agent: string;
  fragments: unknown[];
}

export interface MergedFinding {
  id: string;
  supersedesId: string | null;
}

export interface CurrentFinding {
  id: string;
  reviewId: string;
  agent: string;
  phase: string;
  type: string;
  claim: string;
  manuscriptAnchor: string;
  epistemicStatus: string;
  confidence: number;
  confidenceBand: string;
  severity: string;
  fixability: string;
  scope: string;
  narrativeContext: string | null;
  recommendedAction: string | null;
  supersedesId: string | null;
  createdAt: string;
}

function pad(seq: number): string {
  return seq.toString().padStart(4, '0');
}

function maxSequenceForPrefix(db: MaraDatabase, prefix: string): number {
  const like = `REV-${prefix}-%`;
  const rows = db.all(sql`SELECT id FROM findings WHERE id LIKE ${like}`) as Array<{ id: string }>;
  let max = 0;
  for (const row of rows) {
    const match = /-(\d{4,})$/.exec(row.id);
    if (match !== null) {
      const value = Number.parseInt(match[1] as string, 10);
      if (value > max) {
        max = value;
      }
    }
  }
  return max;
}

function existingIds(db: MaraDatabase, reviewId: string): Set<string> {
  const rows = db.all(sql`SELECT id FROM findings WHERE review_id = ${reviewId}`) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

export function mergeFindings(db: MaraDatabase, input: MergeFindingsInput): MergedFinding[] {
  if (!PREFIX_PATTERN.test(input.lensPrefix)) {
    throw new Error(`Ledger prefix ${input.lensPrefix} must be three or four uppercase letters`);
  }

  const validated: Finding[] = input.fragments.map((fragment, index) => {
    const parsed = findingSchema.safeParse(fragment);
    if (!parsed.success) {
      throw new Error(
        `Ledger fragment ${index} for REV-${input.lensPrefix} is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')} ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data;
  });

  return db.transaction((tx) => {
    const known = existingIds(tx, input.reviewId);
    let seq = maxSequenceForPrefix(tx, input.lensPrefix);
    const merged: MergedFinding[] = [];
    const createdAt = new Date().toISOString();

    for (const finding of validated) {
      let supersedesId: string | null = null;
      if (finding.supersedes !== null) {
        if (!known.has(finding.supersedes)) {
          throw new Error(
            `Ledger merge rejected: finding supersedes ${finding.supersedes} which is not in the ledger for review ${input.reviewId}`,
          );
        }
        supersedesId = finding.supersedes;
      }

      seq += 1;
      const id = `REV-${input.lensPrefix}-${pad(seq)}`;

      tx.insert(findings)
        .values({
          id,
          reviewId: input.reviewId,
          agent: input.agent,
          phase: input.phase,
          type: finding.lens,
          claim: finding.claim,
          manuscriptAnchor: finding.anchor,
          epistemicStatus: finding.epistemic,
          confidence: finding.confidence,
          confidenceBand: finding.band,
          severity: finding.severity,
          fixability: FIXABILITY_TO_DB[finding.fixability],
          scope: SCOPE_TO_DB[finding.scope],
          narrativeContext: finding.failureScenario,
          recommendedAction: finding.leanestFix,
          supersedesId,
          createdAt,
        })
        .run();

      known.add(id);
      merged.push({ id, supersedesId });
    }

    return merged;
  });
}

function mapRow(row: Record<string, unknown>): CurrentFinding {
  return {
    id: row.id as string,
    reviewId: row.review_id as string,
    agent: row.agent as string,
    phase: row.phase as string,
    type: row.type as string,
    claim: row.claim as string,
    manuscriptAnchor: row.manuscript_anchor as string,
    epistemicStatus: row.epistemic_status as string,
    confidence: row.confidence as number,
    confidenceBand: row.confidence_band as string,
    severity: row.severity as string,
    fixability: row.fixability as string,
    scope: row.scope as string,
    narrativeContext: (row.narrative_context as string | null) ?? null,
    recommendedAction: (row.recommended_action as string | null) ?? null,
    supersedesId: (row.supersedes_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function getCurrentFindings(db: MaraDatabase, reviewId: string): CurrentFinding[] {
  const rows = db.all(
    sql`SELECT * FROM v_current_findings WHERE review_id = ${reviewId} ORDER BY id`,
  ) as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export function getCurrentFindingIds(db: MaraDatabase, reviewId: string): Set<string> {
  return new Set(getCurrentFindings(db, reviewId).map((finding) => finding.id));
}
