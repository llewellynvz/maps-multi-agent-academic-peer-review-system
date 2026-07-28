import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MaraClient } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { blobDir } from '../../paths';
import { writeManuscriptBlob } from '../../workflow/storage';
import { clearPassphrase, issueToken, passphraseIsSet, setPassphrase, verifyPassphrase, verifyToken } from '../auth';
import { openKey, sealKey } from '../crypto';
import { addKey, mergeProviderKeyEnv, providerKeyEnv } from '../keys';
import { submitAnswers } from '../answers';
import { createReview, getReviewDetail, purgeAll, purgeReview } from '../reviews';

let tempDir: string;
let client: MaraClient;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-data-'));
  client = createDb(join(tempDir, 'mara.db'));
  runMigrations(client.db);
});

afterEach(() => {
  client.sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('passphrase gate', () => {
  it('sets, verifies, tokenises, and clears the instance passphrase', () => {
    expect(passphraseIsSet(client.db)).toBe(false);
    setPassphrase(client.db, 'open sesame');
    expect(passphraseIsSet(client.db)).toBe(true);
    expect(verifyPassphrase(client.db, 'open sesame')).toBe(true);
    expect(verifyPassphrase(client.db, 'wrong')).toBe(false);

    const issued = issueToken(client.db);
    expect(verifyToken(client.db, issued.token)).toBe(true);
    expect(verifyToken(client.db, 'not.a.token')).toBe(false);
    expect(verifyToken(client.db, `${issued.token}x`)).toBe(false);

    clearPassphrase(client.db);
    expect(passphraseIsSet(client.db)).toBe(false);
    expect(verifyPassphrase(client.db, 'open sesame')).toBe(false);
  });

  it('rejects an expired token', () => {
    setPassphrase(client.db, 'x');
    const expired = issueToken(client.db, -1000);
    expect(verifyToken(client.db, expired.token)).toBe(false);
  });
});

describe('provider key envelope encryption (SEC-13/17)', () => {
  const original = process.env.MARA_MASTER_KEY;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.MARA_MASTER_KEY;
    } else {
      process.env.MARA_MASTER_KEY = original;
    }
  });

  it('round-trips a key and never stores the plaintext', () => {
    process.env.MARA_MASTER_KEY = '0'.repeat(64);
    const secret = 'sk-test-abcd1234';
    const sealed = sealKey(secret);
    expect(openKey(sealed)).toBe(secret);
    expect(sealed.ciphertext.toString('utf8')).not.toContain(secret);
    expect(sealed.ciphertext.toString('latin1')).not.toContain(secret);
  });

  it('fails closed under a wrong master key', () => {
    process.env.MARA_MASTER_KEY = '0'.repeat(64);
    const sealed = sealKey('sk-secret');
    process.env.MARA_MASTER_KEY = '1'.repeat(64);
    expect(() => openKey(sealed)).toThrow();
  });

  it('surfaces a stored key to the provider environment so an added key is actually used', () => {
    process.env.MARA_MASTER_KEY = '0'.repeat(64);
    addKey(client.db, { provider: 'openai', apiKey: 'sk-disk-STOREDKEY', persist: 'disk' });

    expect(providerKeyEnv(client.db).OPENAI_API_KEY).toBe('sk-disk-STOREDKEY');
  });

  it('lets an explicit environment variable win over a stored key', () => {
    process.env.MARA_MASTER_KEY = '0'.repeat(64);
    addKey(client.db, { provider: 'anthropic', apiKey: 'sk-disk-STOREDKEY', persist: 'disk' });

    const merged = mergeProviderKeyEnv({ ANTHROPIC_API_KEY: 'sk-env-WINS' }, providerKeyEnv(client.db));
    expect(merged.ANTHROPIC_API_KEY).toBe('sk-env-WINS');
  });

  it('does not let the blank placeholder from a copied .env shadow a stored key', () => {
    process.env.MARA_MASTER_KEY = '0'.repeat(64);
    addKey(client.db, { provider: 'openai', apiKey: 'sk-disk-STOREDKEY', persist: 'disk' });

    const merged = mergeProviderKeyEnv({ OPENAI_API_KEY: '' }, providerKeyEnv(client.db));
    expect(merged.OPENAI_API_KEY).toBe('sk-disk-STOREDKEY');
  });
});

describe('preset override at the answer step (PIPE-30)', () => {
  it('routes the chosen preset into the resume command', () => {
    const review = createReview(client.db, { title: 'A study' });
    client.sqlite.prepare("UPDATE reviews SET status = 'awaiting_input' WHERE id = ?").run(review.id);
    writeManuscriptBlob(
      review.id,
      'parse/lite-parse.json',
      JSON.stringify({
        deterministic: { wordCount: 100, sectionCount: 3, referenceCount: 5 },
        provisional: { field: 'wellbeing', studyDesign: 'survey', manuscriptType: 'empirical', language: 'en', wordCountEstimate: 100 },
        questions: [
          { id: 'preset', kind: 'preset', field: 'preset', prompt: 'depth', options: ['fast', 'balanced', 'thorough'], defaultValue: 'balanced' },
          { id: 'journal', kind: 'metadata', field: 'journal', prompt: 'journal', defaultValue: null },
        ],
      }),
    );

    submitAnswers(client.db, review.id, {
      answers: [
        { questionId: 'preset', value: 'thorough' },
        { questionId: 'journal', value: 'PLOS ONE' },
      ],
    });

    const command = client.sqlite
      .prepare("SELECT args_json FROM run_commands WHERE review_id = ? AND command = 'resume'")
      .get(review.id) as { args_json: string };
    const args = JSON.parse(command.args_json) as { preset?: string; answers?: Record<string, string> };
    expect(args.preset).toBe('thorough');
    expect(args.answers?.preset).toBe('thorough');
    expect(args.answers?.journal).toBe('PLOS ONE');

    rmSync(blobDir(review.id), { recursive: true, force: true });
  });
});

describe('guarded purge (DATA-19..21)', () => {
  it('removes every row and both on-disk directories', () => {
    const review = createReview(client.db, { title: 'To purge' });
    const now = new Date().toISOString();
    client.sqlite
      .prepare(
        'INSERT INTO manuscripts (id, review_id, original_filename, mime_type, blob_path, byte_size, sha256, ingested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), review.id, 'm.pdf', 'application/pdf', `blobs/${review.id}/manuscript/original.pdf`, 4, 'a'.repeat(64), now);
    client.sqlite
      .prepare(
        `INSERT INTO findings (id, review_id, agent, phase, type, claim, manuscript_anchor, epistemic_status,
         confidence, confidence_band, severity, fixability, scope, created_at)
         VALUES ('REV-STAT-0001', ?, 'x', 'phase_3', 't', 'c', 'p1', 'Known', 0.9, 'Yellow', 'minor', 'easy', 'author_facing', ?)`,
      )
      .run(review.id, now);
    client.sqlite
      .prepare('INSERT INTO review_events (id, review_id, seq, ts, kind, payload_json) VALUES (?, ?, 1, ?, ?, ?)')
      .run(randomUUID(), review.id, now, 'phase_transition', '{}');

    writeManuscriptBlob(review.id, 'manuscript/original.pdf', new Uint8Array([1, 2, 3, 4]));
    expect(existsSync(blobDir(review.id))).toBe(true);

    purgeReview(client, review.id);

    const reviewRow = client.sqlite.prepare('SELECT count(*) AS n FROM reviews WHERE id = ?').get(review.id) as { n: number };
    expect(reviewRow.n).toBe(0);
    for (const table of ['manuscripts', 'findings', 'review_events', 'dispatches', 'run_commands']) {
      const row = client.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE review_id = ?`).get(review.id) as { n: number };
      expect(row.n).toBe(0);
    }
    expect(existsSync(blobDir(review.id))).toBe(false);

    purgeReview(client, review.id);
  });

  it('rejects a path-traversal review id before any filesystem or db operation', () => {
    let code: string | undefined;
    try {
      purgeReview(client, 'x/../../../etc');
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe('bad_request');
  });
});

describe('severityCounts scope boundary', () => {
  it('excludes editor-only findings from the author-visible severity counts', () => {
    const review = createReview(client.db, { title: 'Counts' });
    const now = new Date().toISOString();
    const insert = client.sqlite.prepare(
      `INSERT INTO findings (id, review_id, agent, phase, type, claim, manuscript_anchor, epistemic_status,
       confidence, confidence_band, severity, fixability, scope, created_at)
       VALUES (?, ?, 'x', 'phase_4', 'STAT', 'c', 'p1', 'Known', 0.99, 'Green', ?, 'easy', ?, ?)`,
    );
    insert.run('REV-STAT-0001', review.id, 'major', 'editor_only', now);
    insert.run('REV-STAT-0002', review.id, 'minor', 'author_facing', now);

    const detail = getReviewDetail(client.db, review.id);
    expect(detail.severityCounts.major).toBeUndefined();
    expect(detail.severityCounts.minor).toBe(1);

    purgeReview(client, review.id);
  });
});

describe('purgeAll', () => {
  it('purges every review, sweeps orphan directories, and clears ingest snapshots', () => {
    const first = createReview(client.db, { title: 'First' });
    createReview(client.db, { title: 'Second' });
    const now = new Date().toISOString();
    client.sqlite
      .prepare(
        `INSERT INTO findings (id, review_id, agent, phase, type, claim, manuscript_anchor, epistemic_status,
         confidence, confidence_band, severity, fixability, scope, created_at)
         VALUES ('REV-STAT-0001', ?, 'x', 'phase_3', 't', 'c', 'p1', 'Known', 0.9, 'Yellow', 'minor', 'easy', 'author_facing', ?)`,
      )
      .run(first.id, now);
    client.sqlite
      .prepare('INSERT INTO review_events (id, review_id, seq, ts, kind, payload_json) VALUES (?, ?, 1, ?, ?, ?)')
      .run(randomUUID(), first.id, now, 'phase_transition', '{}');
    client.sqlite
      .prepare('INSERT INTO merge_markers (id, review_id, marker, created_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), first.id, 'p4-stats-deterministic', now);

    const blobsRoot = join(tempDir, 'blobs');
    const deliverablesRoot = join(tempDir, 'deliverables');
    mkdirSync(join(blobsRoot, 'orphan-review-id'), { recursive: true });
    mkdirSync(join(deliverablesRoot, 'another-orphan'), { recursive: true });
    mkdirSync(join(blobsRoot, 'not_a.review.id'), { recursive: true });

    const mastraPath = join(tempDir, 'mastra.db');
    const mastra = new Database(mastraPath);
    mastra.exec('CREATE TABLE mastra_workflow_snapshot (workflow_name TEXT, run_id TEXT, snapshot TEXT)');
    mastra.prepare('INSERT INTO mastra_workflow_snapshot VALUES (?, ?, ?)').run('ingest', 'run-1', '{}');
    mastra.close();

    const result = purgeAll(client, { blobsRoot, deliverablesRoot, mastraPath });

    expect(result.purged).toBe(2);
    expect(result.orphansRemoved).toBe(2);
    expect(result.snapshotsCleared).toBe(1);
    const rows = client.sqlite.prepare('SELECT count(*) AS n FROM reviews').get() as { n: number };
    expect(rows.n).toBe(0);
    for (const table of ['findings', 'review_events', 'merge_markers']) {
      const child = client.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      expect(child.n).toBe(0);
    }
    expect(existsSync(join(blobsRoot, 'orphan-review-id'))).toBe(false);
    expect(existsSync(join(deliverablesRoot, 'another-orphan'))).toBe(false);
    expect(existsSync(join(blobsRoot, 'not_a.review.id'))).toBe(true);

    const reopened = new Database(mastraPath, { readonly: true });
    const snapshots = reopened.prepare('SELECT count(*) AS n FROM mastra_workflow_snapshot').get() as { n: number };
    reopened.close();
    expect(snapshots.n).toBe(0);
  });

  it('refuses while any review is queued, sanitizing, or running, leaving ingest snapshots intact', () => {
    const review = createReview(client.db, { title: 'Active' });
    client.sqlite.prepare("UPDATE reviews SET status = 'running' WHERE id = ?").run(review.id);

    const mastraPath = join(tempDir, 'mastra.db');
    const mastra = new Database(mastraPath);
    mastra.exec('CREATE TABLE mastra_workflow_snapshot (workflow_name TEXT, run_id TEXT, snapshot TEXT)');
    mastra.prepare('INSERT INTO mastra_workflow_snapshot VALUES (?, ?, ?)').run('ingest', 'run-live', '{}');
    mastra.close();

    let code: string | undefined;
    try {
      purgeAll(client, { blobsRoot: join(tempDir, 'blobs'), deliverablesRoot: join(tempDir, 'deliverables'), mastraPath });
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe('conflict');
    const rows = client.sqlite.prepare('SELECT count(*) AS n FROM reviews').get() as { n: number };
    expect(rows.n).toBe(1);

    const reopened = new Database(mastraPath, { readonly: true });
    const snapshots = reopened.prepare('SELECT count(*) AS n FROM mastra_workflow_snapshot').get() as { n: number };
    reopened.close();
    expect(snapshots.n).toBe(1);
  });
});
