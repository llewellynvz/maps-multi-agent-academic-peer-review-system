import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { assertAllowedHost, createGuardedFetch } from '../allowlist';
import { openCitationCache } from '../cache';
import { createCitationClient } from '../client';
import { createRateLimiter } from '../rate-limiter';
import { scoreCandidate } from '../scoring';
import type { FetchLike, HttpResponse, Reference } from '../types';

function json(body: unknown): HttpResponse {
  return { ok: true, status: 200, json: async (): Promise<unknown> => body };
}

const empty: HttpResponse = { ok: true, status: 200, json: async (): Promise<unknown> => ({}) };

const fastLimiter = createRateLimiter({ minIntervalMs: 0 });

function crossrefWork(title: string, doi: string, year: number): unknown {
  return { message: { title: [title], DOI: doi, published: { 'date-parts': [[year]] } } };
}

const seligman: Reference = {
  title: 'Positive psychology: An introduction',
  authors: ['Seligman', 'Csikszentmihalyi'],
  year: 2000,
  doi: '10.1037/0003-066X.55.1.5',
};

describe('verifyReference', () => {
  it('verifies a known good reference from the first backend that resolves it', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes('api.crossref.org/works/')) {
        return json(crossrefWork('Positive psychology: An introduction', '10.1037/0003-066X.55.1.5', 2000));
      }
      return empty;
    };
    const client = createCitationClient({ fetchImpl, cache: null, rateLimiter: fastLimiter });

    const result = await client.verifyReference(seligman);

    expect(result.status).toBe('verified');
    expect(result.source).toBe('crossref');
    expect(result.matchedDoi).toBe('10.1037/0003-066X.55.1.5');
    expect(result.confidence).toBeGreaterThan(0.9);
    client.close();
  });

  it('returns not_found when every backend has no match', async () => {
    const fetchImpl: FetchLike = async () => empty;
    const client = createCitationClient({ fetchImpl, cache: null, rateLimiter: fastLimiter });

    const result = await client.verifyReference({
      title: 'The quantum mechanics of team flourishing',
      authors: ['Van Der Fakename'],
      year: 2019,
      doi: '10.9999/fake.12345',
    });

    expect(result.status).toBe('not_found');
    expect(result.source).toBeNull();
    expect(result.confidence).toBe(0);
    client.close();
  });

  it('returns mismatch with lowered confidence for a near-miss title', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes('api.crossref.org/works?')) {
        return json({
          message: {
            items: [
              {
                title: ['The quantum mechanics of flourishing teams and groups'],
                published: { 'date-parts': [[2019]] },
              },
            ],
          },
        });
      }
      return empty;
    };
    const client = createCitationClient({ fetchImpl, cache: null, rateLimiter: fastLimiter });

    const result = await client.verifyReference({
      title: 'The quantum mechanics of team flourishing',
      authors: ['Researcher'],
      year: 2019,
    });

    expect(result.status).toBe('mismatch');
    expect(result.source).toBe('crossref');
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.confidence).toBeGreaterThan(0);
    client.close();
  });

  it('falls through to a later backend when earlier ones return nothing', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes('api.semanticscholar.org')) {
        return json({ title: 'Positive psychology: An introduction', year: 2000, externalIds: { DOI: '10.1037/0003-066X.55.1.5' } });
      }
      return empty;
    };
    const client = createCitationClient({ fetchImpl, cache: null, rateLimiter: fastLimiter });

    const result = await client.verifyReference(seligman);

    expect(result.status).toBe('verified');
    expect(result.source).toBe('semantic_scholar');
    client.close();
  });

  it('does not cache a not_found produced by a total backend outage', async () => {
    let mode: 'outage' | 'ok' = 'outage';
    const fetchImpl: FetchLike = async (url) => {
      if (mode === 'outage') {
        throw new Error('network down');
      }
      if (url.includes('api.crossref.org/works/')) {
        return json(crossrefWork('Positive psychology: An introduction', '10.1037/0003-066X.55.1.5', 2000));
      }
      return empty;
    };
    const cache = openCitationCache({ path: ':memory:' });
    const client = createCitationClient({ fetchImpl, cache, rateLimiter: fastLimiter });

    const first = await client.verifyReference(seligman);
    expect(first.status).toBe('not_found');

    mode = 'ok';
    const second = await client.verifyReference(seligman);
    expect(second.status).toBe('verified');
    cache.close();
  });

  it('does not cache a not_found produced by rate-limited backends that answered with 429', async () => {
    let mode: 'throttled' | 'ok' = 'throttled';
    const throttled: HttpResponse = { ok: false, status: 429, json: async (): Promise<unknown> => ({}) };
    const fetchImpl: FetchLike = async (url) => {
      if (mode === 'throttled') {
        return throttled;
      }
      if (url.includes('api.crossref.org/works/')) {
        return json(crossrefWork('Positive psychology: An introduction', '10.1037/0003-066X.55.1.5', 2000));
      }
      return empty;
    };
    const cache = openCitationCache({ path: ':memory:' });
    const client = createCitationClient({ fetchImpl, cache, rateLimiter: fastLimiter });

    const during = await client.verifyReference(seligman);
    expect(during.status).toBe('not_found');

    mode = 'ok';
    const afterRecovery = await client.verifyReference(seligman);
    expect(afterRecovery.status).toBe('verified');
    cache.close();
  });

  it('falls back to a title search when a damaged DOI resolves to nothing', async () => {
    const damaged: Reference = { ...seligman, doi: '10.1037/0003-066X.55.1.6' };
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url);
      if (url.includes('api.crossref.org/works/')) {
        return { ok: false, status: 404, json: async (): Promise<unknown> => ({}) };
      }
      if (url.includes('api.crossref.org/works?')) {
        return json({
          message: {
            items: [
              { title: ['Positive psychology: An introduction'], DOI: '10.1037/0003-066X.55.1.5', published: { 'date-parts': [[2000]] } },
            ],
          },
        });
      }
      return empty;
    };
    const client = createCitationClient({ fetchImpl, cache: null, rateLimiter: fastLimiter });

    const result = await client.verifyReference(damaged);

    expect(urls.some((url) => url.includes('query.bibliographic'))).toBe(true);
    expect(result.status).not.toBe('not_found');
  });

  it('purges rows older than the TTL when the cache is opened', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mara-cache-'));
    const path = join(dir, 'cache.db');
    const raw = new DatabaseConstructor(path);
    raw.exec(
      'CREATE TABLE citation_cache (query_key TEXT PRIMARY KEY, source TEXT, payload_json TEXT NOT NULL, fetched_at TEXT NOT NULL)',
    );
    const stale = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    raw.prepare('INSERT INTO citation_cache VALUES (?, ?, ?, ?)').run('stale', 'crossref', '{}', stale);
    raw.prepare('INSERT INTO citation_cache VALUES (?, ?, ?, ?)').run('fresh', 'crossref', '{}', fresh);
    raw.close();

    const cache = openCitationCache({ path, ttlMs: 30 * 24 * 60 * 60 * 1000 });
    cache.close();

    const check = new DatabaseConstructor(path);
    const keys = (check.prepare('SELECT query_key FROM citation_cache').all() as Array<{ query_key: string }>).map(
      (row) => row.query_key,
    );
    check.close();
    rmSync(dir, { recursive: true, force: true });

    expect(keys).toEqual(['fresh']);
  });

  it('serves a cache hit without any further network calls', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      if (url.includes('api.crossref.org/works/')) {
        return json(crossrefWork('Positive psychology: An introduction', '10.1037/0003-066X.55.1.5', 2000));
      }
      return empty;
    });
    const cache = openCitationCache({ path: ':memory:' });
    const client = createCitationClient({ fetchImpl, cache, rateLimiter: fastLimiter });

    const first = await client.verifyReference(seligman);
    const callsAfterFirst = fetchImpl.mock.calls.length;
    const second = await client.verifyReference(seligman);

    expect(first.status).toBe('verified');
    expect(second).toEqual(first);
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst);
    cache.close();
  });
});

describe('scoreCandidate', () => {
  const reference: Reference = { title: 'Positive psychology: An introduction', authors: ['Seligman'], year: 2000 };

  it('verifies a strong title match when the backend record has no year', () => {
    const scored = scoreCandidate(reference, { title: 'Positive psychology: An introduction' });
    expect(scored.status).toBe('verified');
  });

  it('does not verify a strong title match when the year conflicts', () => {
    const scored = scoreCandidate(reference, { title: 'Positive psychology: An introduction', year: 1980 });
    expect(scored.status).not.toBe('verified');
  });

  it('tokenizes a non-Latin title instead of collapsing it to empty', () => {
    const cyrillic: Reference = { title: 'Психология благополучия', authors: [], year: 2020 };
    const scored = scoreCandidate(cyrillic, { title: 'Психология благополучия', year: 2020 });
    expect(scored.status).toBe('verified');
  });
});

describe('egress guard', () => {
  it('rejects any host outside the citation allowlist', () => {
    expect(() => assertAllowedHost('https://evil.example.com/works/1')).toThrow(/allowlist/);
    expect(() => assertAllowedHost('https://api.crossref.org/works/1')).not.toThrow();
  });

  it('blocks a non-allowlisted host before the underlying fetch runs', async () => {
    const underlying = vi.fn<FetchLike>(async () => empty);
    const guarded = createGuardedFetch(underlying, fastLimiter);

    await expect(guarded('https://exfiltrate.test/leak')).rejects.toThrow(/allowlist/);
    expect(underlying).not.toHaveBeenCalled();
  });
});

describe('rate limiter', () => {
  it('spaces successive calls to the same host by the configured interval', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const limiter = createRateLimiter({
      minIntervalMs: 1000,
      now: () => clock,
      sleep: async (ms: number): Promise<void> => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    await limiter.acquire('api.crossref.org');
    await limiter.acquire('api.crossref.org');

    expect(sleeps).toEqual([1000]);
  });

  it('does not delay calls to different hosts', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const limiter = createRateLimiter({
      minIntervalMs: 1000,
      now: () => clock,
      sleep: async (ms: number): Promise<void> => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    await limiter.acquire('api.crossref.org');
    await limiter.acquire('api.openalex.org');

    expect(sleeps).toEqual([]);
  });
});

describe('scoreCandidate corroboration', () => {
  it('does not confirm a sibling paper when the reference year is unknown', () => {
    const scored = scoreCandidate(
      { title: 'Deep learning for medical image segmentation: Part I', authors: ['Ng'], year: 0 },
      { title: 'Deep learning for medical image segmentation: Part II', doi: '10.1000/partII', year: 2021 },
    );
    expect(scored.status).toBe('mismatch');
  });

  it('still confirms an exact title match when neither side carries a year', () => {
    const scored = scoreCandidate(
      { title: 'Positive psychology: An introduction', authors: ['Seligman'], year: 0 },
      { title: 'Positive psychology: An introduction' },
    );
    expect(scored.status).toBe('verified');
  });
});
