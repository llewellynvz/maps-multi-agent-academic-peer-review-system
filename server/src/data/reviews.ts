import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { desc, eq, sql } from 'drizzle-orm';
import type { MaraClient, MaraDatabase } from '../db/client';
import { phaseCheckpoints, reviews } from '../db/schema';
import { blobDir, dataDir } from '../paths';
import { nowIso } from './db';
import { ApiError } from './errors';
import type { Review, ReviewDetail, ReviewOptions, ReviewSummary } from './types';

function slugify(title: string | null, id: string): string {
  const base = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const suffix = id.slice(0, 8);
  return base.length > 0 ? `${base}-${suffix}` : `review-${suffix}`;
}

function toReview(row: typeof reviews.$inferSelect): Review {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status as Review['status'],
    currentPhase: row.currentPhase,
    recommendation: row.recommendation,
    recommendationConfidence: row.recommendationConfidence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateReviewInput {
  title?: string | null;
  providerProfile?: string;
  options?: ReviewOptions;
}

export function createReview(db: MaraDatabase, input: CreateReviewInput): Review {
  const id = randomUUID();
  const ts = nowIso();
  const slug = slugify(input.title ?? null, id);
  const options = input.options ?? {};
  db.insert(reviews)
    .values({
      id,
      slug,
      title: input.title ?? null,
      status: 'created',
      providerProfile: input.providerProfile ?? 'default',
      optionsJson: JSON.stringify(options),
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  const row = db.select().from(reviews).where(eq(reviews.id, id)).limit(1).all()[0];
  if (row === undefined) {
    throw new ApiError('internal', 'Review row could not be read back after insertion.');
  }
  return toReview(row);
}

export function getReviewRow(db: MaraDatabase, id: string): typeof reviews.$inferSelect | undefined {
  return db.select().from(reviews).where(eq(reviews.id, id)).limit(1).all()[0];
}

export function requireReview(db: MaraDatabase, id: string): Review {
  const row = getReviewRow(db, id);
  if (row === undefined) {
    throw new ApiError('not_found', `No review with id ${id}.`);
  }
  return toReview(row);
}

function findingsCount(db: MaraDatabase, reviewId: string): number {
  const row = db.all(
    sql`SELECT count(*) AS n FROM v_current_findings WHERE review_id = ${reviewId}`,
  )[0] as { n: number } | undefined;
  return row?.n ?? 0;
}

function rubricAverage(db: MaraDatabase, reviewId: string): number | null {
  const row = db.all(
    sql`SELECT avg(score) AS avg FROM rubric_scores WHERE review_id = ${reviewId} AND state = 'final'`,
  )[0] as { avg: number | null } | undefined;
  return row?.avg ?? null;
}

export function listReviews(db: MaraDatabase): ReviewSummary[] {
  const rows = db.select().from(reviews).orderBy(desc(reviews.createdAt)).all();
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status as ReviewSummary['status'],
    currentPhase: row.currentPhase,
    createdAt: row.createdAt,
    findingsCount: findingsCount(db, row.id),
    recommendation: row.recommendation,
    rubricAverage: rubricAverage(db, row.id),
  }));
}

export function getReviewDetail(db: MaraDatabase, id: string): ReviewDetail {
  const review = requireReview(db, id);
  const severityRows = db.all(
    sql`SELECT severity, count(*) AS n FROM v_current_findings WHERE review_id = ${id} GROUP BY severity`,
  ) as Array<{ severity: string; n: number }>;
  const severityCounts: Record<string, number> = {};
  for (const row of severityRows) {
    severityCounts[row.severity] = row.n;
  }
  const checkpointRows = db
    .select()
    .from(phaseCheckpoints)
    .where(eq(phaseCheckpoints.reviewId, id))
    .all();
  const checkpoints = checkpointRows.map((row) => ({
    phase: row.phase,
    status: row.status,
    gateVerdict: row.gateVerdict,
    fixCycleCount: row.fixCycleCount,
  }));
  return { ...review, severityCounts, checkpoints };
}

export function purgeReview(client: MaraClient, id: string): void {
  const { db, sqlite } = client;
  if (getReviewRow(db, id) === undefined) {
    removeReviewDirectories(id);
    return;
  }

  const purge = sqlite.transaction(() => {
    sqlite.exec('CREATE TEMP TABLE IF NOT EXISTS _mara_purge (marker INTEGER)');
    sqlite.prepare('DELETE FROM reviews WHERE id = ?').run(id);
    sqlite.exec('DROP TABLE IF EXISTS _mara_purge');
  });
  purge();

  removeReviewDirectories(id);

  const tables = [
    'manuscripts',
    'findings',
    'phase_checkpoints',
    'review_events',
    'dispatches',
    'rubric_scores',
    'deliverables',
    'run_commands',
  ];
  for (const table of tables) {
    const row = sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE review_id = ?`).get(id) as { n: number };
    if (row.n > 0) {
      throw new ApiError('internal', `Purge left ${row.n} rows in ${table} for review ${id}.`);
    }
  }
}

function removeReviewDirectories(id: string): void {
  const directories = [blobDir(id), resolve(dataDir(), 'deliverables', id)];
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
    if (existsSync(directory)) {
      throw new ApiError('internal', `Purge could not remove ${directory}. Close any open file handles and retry.`);
    }
  }
}
