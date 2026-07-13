import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Finding } from '@mara/shared';
import { createDb, type MaraDatabase, type SqliteConnection } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { getCurrentFindings, mergeFindings } from '../index';

let tempDir: string;
let db: MaraDatabase;
let sqlite: SqliteConnection;
const REVIEW = 'review-ledger-test';

function finding(overrides: Partial<Finding> = {}): unknown {
  return {
    id: 'REV-XXX-0001',
    lens: 'statistical',
    phase: 3,
    claim: 'The reported mean of 8.4 exceeds the declared 1 to 7 scale ceiling.',
    anchor: 'Table 2, row 3',
    epistemic: 'Known',
    confidence: 0.9,
    band: 'Yellow',
    severity: 'major',
    fixability: 'moderate',
    scope: 'editor-only',
    failureScenario: 'A mean above the scale ceiling indicates a coding or reporting error.',
    leanestFix: 'Recompute the descriptive statistics from the raw scale range.',
    supersedes: null,
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-ledger-'));
  const client = createDb(join(tempDir, 'mara.db'));
  db = client.db;
  sqlite = client.sqlite;
  runMigrations(db);
  const now = new Date().toISOString();
  sqlite.prepare('INSERT INTO reviews (id, slug, created_at, updated_at) VALUES (?, ?, ?, ?)').run(REVIEW, REVIEW, now, now);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('ledger merge', () => {
  it('assigns namespaced REV-<LENS>-<NNNN> ids with per-lens counters that continue across merges', () => {
    const first = mergeFindings(db, {
      reviewId: REVIEW,
      lensPrefix: 'STAT',
      phase: 'phase_3',
      agent: 'specialist-reviewer',
      fragments: [finding(), finding({ claim: 'Second statistical concern.' })],
    });
    expect(first.map((f) => f.id)).toEqual(['REV-STAT-0001', 'REV-STAT-0002']);

    const second = mergeFindings(db, {
      reviewId: REVIEW,
      lensPrefix: 'STAT',
      phase: 'phase_3',
      agent: 'specialist-reviewer',
      fragments: [finding({ claim: 'Third statistical concern.' })],
    });
    expect(second.map((f) => f.id)).toEqual(['REV-STAT-0003']);

    const other = mergeFindings(db, {
      reviewId: REVIEW,
      lensPrefix: 'NOV',
      phase: 'phase_3',
      agent: 'specialist-reviewer',
      fragments: [finding({ lens: 'novelty', claim: 'A novelty concern.' })],
    });
    expect(other.map((f) => f.id)).toEqual(['REV-NOV-0001']);
  });

  it('rejects a batch when any fragment has a blank anchor and inserts nothing', () => {
    expect(() =>
      mergeFindings(db, {
        reviewId: REVIEW,
        lensPrefix: 'STAT',
        phase: 'phase_3',
        agent: 'specialist-reviewer',
        fragments: [finding(), finding({ anchor: '' })],
      }),
    ).toThrow();
    expect(getCurrentFindings(db, REVIEW)).toHaveLength(0);
  });

  it('rolls the whole batch back when a later row fails, leaving no partial insert', () => {
    expect(() =>
      mergeFindings(db, {
        reviewId: REVIEW,
        lensPrefix: 'STAT',
        phase: 'phase_3',
        agent: 'specialist-reviewer',
        fragments: [finding(), finding({ supersedes: 'REV-STAT-9999' })],
      }),
    ).toThrow(/supersedes REV-STAT-9999/);
    expect(getCurrentFindings(db, REVIEW)).toHaveLength(0);
  });

  it('supersedes a prior finding with a new row and hides the superseded one from the current view', () => {
    const [original] = mergeFindings(db, {
      reviewId: REVIEW,
      lensPrefix: 'STAT',
      phase: 'phase_3',
      agent: 'specialist-reviewer',
      fragments: [finding()],
    });
    expect(original?.id).toBe('REV-STAT-0001');

    const [correction] = mergeFindings(db, {
      reviewId: REVIEW,
      lensPrefix: 'STAT',
      phase: 'phase_3',
      agent: 'specialist-reviewer',
      fragments: [
        finding({
          claim: 'On re-check against the raw range the mean is within scale; concern withdrawn.',
          severity: 'minor',
          supersedes: 'REV-STAT-0001',
        }),
      ],
    });
    expect(correction?.id).toBe('REV-STAT-0002');
    expect(correction?.supersedesId).toBe('REV-STAT-0001');

    const current = getCurrentFindings(db, REVIEW);
    expect(current.map((f) => f.id)).toEqual(['REV-STAT-0002']);
    expect(current[0]?.severity).toBe('minor');
  });

  it('keeps finding ids globally unique across reviews sharing one findings table', () => {
    const now = new Date().toISOString();
    const secondReview = 'review-ledger-test-2';
    sqlite
      .prepare('INSERT INTO reviews (id, slug, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(secondReview, secondReview, now, now);

    const first = mergeFindings(db, {
      reviewId: REVIEW,
      lensPrefix: 'STAT',
      phase: 'phase_3',
      agent: 'specialist-reviewer',
      fragments: [finding()],
    });
    const second = mergeFindings(db, {
      reviewId: secondReview,
      lensPrefix: 'STAT',
      phase: 'phase_3',
      agent: 'specialist-reviewer',
      fragments: [finding()],
    });
    expect(first.map((f) => f.id)).toEqual(['REV-STAT-0001']);
    expect(second.map((f) => f.id)).toEqual(['REV-STAT-0002']);
    expect(getCurrentFindings(db, secondReview).map((f) => f.id)).toEqual(['REV-STAT-0002']);
  });

  it('maps hyphenated enum values to the underscored ledger columns', () => {
    mergeFindings(db, {
      reviewId: REVIEW,
      lensPrefix: 'ETH',
      phase: 'phase_3',
      agent: 'specialist-reviewer',
      fragments: [
        finding({ lens: 'ethics', scope: 'author-facing', fixability: 'not-fixable-from-current-study' }),
      ],
    });
    const current = getCurrentFindings(db, REVIEW);
    expect(current[0]?.scope).toBe('author_facing');
    expect(current[0]?.fixability).toBe('not_fixable_from_current_study');
  });
});
