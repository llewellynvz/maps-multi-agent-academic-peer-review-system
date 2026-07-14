import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MaraClient } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { announceFindings, findingHeadline } from '../../worker/announce';
import { accessDenied, issueToken, setPassphrase } from '../auth';
import { deriveEphemeral, maxSeq, replayEvents } from '../events';

let tempDir: string;
let client: MaraClient;

function insertReview(id: string): void {
  const now = new Date().toISOString();
  client.sqlite
    .prepare("INSERT INTO reviews (id, slug, status, current_phase, created_at, updated_at) VALUES (?, ?, 'running', 'phase_3', ?, ?)")
    .run(id, id, now, now);
}

function insertEvent(reviewId: string, seq: number, kind: string, payload: unknown, phase: string | null = null): void {
  client.sqlite
    .prepare('INSERT INTO review_events (id, review_id, seq, ts, kind, phase, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), reviewId, seq, new Date().toISOString(), kind, phase, JSON.stringify(payload));
}

function insertFinding(id: string, reviewId: string, scope: string, claim: string, severity: string): void {
  client.sqlite
    .prepare(
      `INSERT INTO findings (id, review_id, agent, phase, type, claim, manuscript_anchor, epistemic_status,
       confidence, confidence_band, severity, fixability, scope, created_at)
       VALUES (?, ?, 'x', 'phase_3', 'statistics', ?, 'p. 4', 'Known', 0.9, 'Yellow', ?, 'easy', ?, ?)`,
    )
    .run(id, reviewId, claim, severity, scope, new Date().toISOString());
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-events-'));
  client = createDb(join(tempDir, 'mara.db'));
  runMigrations(client.db);
});

afterEach(() => {
  client.sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('SSE persisted replay (API-22/26)', () => {
  it('replays only the streamed kinds after Last-Event-ID, in order, with the right names', () => {
    insertReview('rev-1');
    insertEvent('rev-1', 1, 'phase_transition', { step: 'x' }, 'phase_1');
    insertEvent('rev-1', 2, 'control_ack', { commandId: 'c1' });
    insertEvent('rev-1', 3, 'gate_verdict', { verdict: 'pass', cycle: 1 }, 'phase_7');
    insertEvent('rev-1', 4, 'web_query', { q: 'x' });
    insertEvent('rev-1', 5, 'finding_recorded', { findingId: 'REV-STAT-0001', severity: 'major', scope: 'author_facing', headline: 'x' });
    insertEvent('rev-1', 6, 'run_terminal', { outcome: 'complete', recommendation: 'minor_revision' }, 'phase_8');

    const all = replayEvents(client.db, 'rev-1', 0);
    expect(all.map((e) => e.event)).toEqual(['phase_status', 'gate_verdict', 'finding_headline', 'run_complete']);
    expect(all.map((e) => e.seq)).toEqual([1, 3, 5, 6]);

    const afterThree = replayEvents(client.db, 'rev-1', 3);
    expect(afterThree.map((e) => e.seq)).toEqual([5, 6]);
    expect(maxSeq(client.db, 'rev-1')).toBe(6);
  });

  it('maps a failed terminal to run_failed', () => {
    insertReview('rev-2');
    insertEvent('rev-2', 1, 'run_terminal', { outcome: 'failed', errorClass: 'engine_error' }, 'phase_8');
    expect(replayEvents(client.db, 'rev-2', 0)[0]?.event).toBe('run_failed');
  });

  it('maps a release-gate halt terminal (released false, no outcome) to run_failed', () => {
    insertReview('rev-4');
    insertEvent('rev-4', 1, 'run_terminal', { released: false, reason: 'Forced halt at the release gate.' }, 'phase_7');
    expect(replayEvents(client.db, 'rev-4', 0)[0]?.event).toBe('run_failed');
  });
});

describe('editor-only masking (API-25, UI-33)', () => {
  it('never puts editor-only finding text into the finding_headline stream', () => {
    insertReview('rev-3');
    insertFinding('REV-STAT-0001', 'rev-3', 'author_facing', 'The sample size is underpowered.', 'moderate');
    insertFinding('REV-SIM-0001', 'rev-3', 'editor_only', 'Overlap with an unpublished thesis chapter 3.', 'major');

    announceFindings(client.db, 'rev-3', new Set());

    const events = replayEvents(client.db, 'rev-3', 0).filter((e) => e.event === 'finding_headline');
    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain('unpublished thesis');
    const editorEvent = events.find((e) => (e.data as { findingId: string }).findingId === 'REV-SIM-0001');
    expect((editorEvent?.data as { scope: string }).scope).toBe('editor_only');
    expect((editorEvent?.data as { headline: string }).headline).toBe('Confidential signal recorded');

    const ephemeral = JSON.stringify(deriveEphemeral(client.db, 'rev-3'));
    expect(ephemeral).not.toContain('unpublished thesis');
  });

  it('produces an author-facing headline that omits the raw claim', () => {
    const headline = findingHeadline({ id: 'REV-STAT-0001', type: 'statistics', severity: 'moderate', scope: 'author_facing' });
    expect(headline.headline).toBe('moderate statistics finding');
    expect(headline.headline).not.toContain('underpowered');
  });
});

describe('access guard (API-02)', () => {
  it('is open when no passphrase is set and closed without a token when one is', () => {
    expect(accessDenied(client.db, null)).toBe(false);
    setPassphrase(client.db, 'secret');
    expect(accessDenied(client.db, null)).toBe(true);
    expect(accessDenied(client.db, 'garbage')).toBe(true);
    const token = issueToken(client.db).token;
    expect(accessDenied(client.db, token)).toBe(false);
  });
});
