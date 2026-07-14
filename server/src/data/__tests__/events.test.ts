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
    expect(all.map((e) => e.event)).toEqual(['phase_status', 'gate_verdict', 'log_event', 'finding_headline', 'run_complete']);
    expect(all.map((e) => e.seq)).toEqual([1, 3, 4, 5, 6]);

    const afterFour = replayEvents(client.db, 'rev-1', 4);
    expect(afterFour.map((e) => e.seq)).toEqual([5, 6]);
    expect(maxSeq(client.db, 'rev-1')).toBe(6);
  });

  it('maxSeq returns the highest streamed seq, matching the old reduce and ignoring higher non-streamed events', () => {
    insertReview('rev-max');
    insertEvent('rev-max', 1, 'phase_transition', {}, 'phase_1');
    insertEvent('rev-max', 2, 'web_query', {});
    insertEvent('rev-max', 3, 'gate_verdict', { verdict: 'pass' }, 'phase_7');
    insertEvent('rev-max', 4, 'control_ack', { commandId: 'c1' });

    const rows = client.sqlite
      .prepare("SELECT seq, kind FROM review_events WHERE review_id = 'rev-max'")
      .all() as Array<{ seq: number; kind: string }>;
    const streamed = new Set(['phase_transition', 'gate_verdict', 'finding_recorded', 'run_terminal']);
    const oldImpl = rows.reduce((max, row) => (streamed.has(row.kind) && row.seq > max ? row.seq : max), 0);

    expect(maxSeq(client.db, 'rev-max')).toBe(oldImpl);
    expect(maxSeq(client.db, 'rev-max')).toBe(3);
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

  it('carries the failing phase on run_failed so recovery can target it', () => {
    insertReview('rev-5');
    insertEvent('rev-5', 1, 'run_terminal', { released: false, reason: 'halt' }, 'phase_7');
    const data = replayEvents(client.db, 'rev-5', 0)[0]?.data as { phase?: string };
    expect(data.phase).toBe('phase_7');
  });
});

describe('activity log stream confidentiality (H2c)', () => {
  it('streams web_query rows as log events built only from the egress columns, truncated', () => {
    insertReview('rev-log');
    const longQuery = 'a'.repeat(300);
    client.sqlite
      .prepare(
        "INSERT INTO review_events (id, review_id, seq, ts, kind, phase, payload_json, egress_target, egress_query) VALUES (?, 'rev-log', 1, ?, 'web_query', 'phase_2', '{}', 'crossref', ?)",
      )
      .run(randomUUID(), new Date().toISOString(), longQuery);
    const mapped = replayEvents(client.db, 'rev-log', 0)[0];
    expect(mapped?.event).toBe('log_event');
    const data = mapped?.data as { message: string; ts: string };
    expect(data.message).toContain('crossref');
    expect(data.message.length).toBeLessThan(200);
    expect(data.ts.length).toBeGreaterThan(0);
  });

  it('keeps finding claims and manuscript text out of every log surface', () => {
    insertReview('rev-log2');
    insertFinding('REV-STAT-0001', 'rev-log2', 'author_facing', 'the unpublished thesis result is fabricated', 'major');
    client.sqlite
      .prepare(
        `INSERT INTO dispatches (id, review_id, phase, agent, provider, model, prompt_version, latency_ms, cost_usd, status, created_at)
         VALUES (?, 'rev-log2', 'phase_3', 'specialist-reviewer', 'azure', 'gpt-5.1', 'v1', 1200, 0.01, 'success', ?)`,
      )
      .run(randomUUID(), new Date().toISOString());
    const ephemeral = deriveEphemeral(client.db, 'rev-log2');
    const dispatchLog = ephemeral.find((event) => event.event === 'dispatch_log');
    expect(dispatchLog).toBeDefined();
    const serialised = JSON.stringify(dispatchLog);
    expect(serialised).not.toContain('unpublished thesis');
    expect(serialised).not.toContain('claim');
    expect(serialised).toContain('specialist-reviewer');
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
    expect(headline.headline).toBe('Statistical recorded a moderate issue');
    expect(headline.lensPrefix).toBe('STAT');
    expect(headline.lensDisplay).toBe('Statistical');
    expect(headline.headline).not.toContain('underpowered');
  });
});

describe('finding announcements (B2)', () => {
  it('never announces severity-none findings', () => {
    insertReview('rev-none');
    insertFinding('REV-STAT-0001', 'rev-none', 'author_facing', 'A small wording nit.', 'minor');
    insertFinding('REV-METH-0001', 'rev-none', 'author_facing', 'No issue was found here.', 'none');

    announceFindings(client.db, 'rev-none', new Set());

    const events = replayEvents(client.db, 'rev-none', 0).filter((e) => e.event === 'finding_headline');
    const ids = events.map((e) => (e.data as { findingId: string }).findingId);
    expect(ids).toContain('REV-STAT-0001');
    expect(ids).not.toContain('REV-METH-0001');
  });

  it('carries the lens prefix and display in the payload with a template headline, not the claim', () => {
    insertReview('rev-lens');
    insertFinding('REV-STAT-0001', 'rev-lens', 'author_facing', 'The sample size is underpowered.', 'moderate');

    announceFindings(client.db, 'rev-lens', new Set());

    const event = replayEvents(client.db, 'rev-lens', 0).find((e) => e.event === 'finding_headline');
    const data = event?.data as { lensPrefix: string; lensDisplay: string; headline: string };
    expect(data.lensPrefix).toBe('STAT');
    expect(data.lensDisplay).toBe('Statistical');
    expect(data.headline).toBe('Statistical recorded a moderate issue');
    expect(JSON.stringify(event)).not.toContain('underpowered');
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
