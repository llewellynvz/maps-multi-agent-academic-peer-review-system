import { describe, expect, it, vi } from 'vitest';
import { assertAllowedHost, createGuardedFetch } from '../allowlist';
import { openCitationCache } from '../cache';
import { createCitationClient } from '../client';
import { createRateLimiter } from '../rate-limiter';
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
