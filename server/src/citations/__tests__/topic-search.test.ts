import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CROSSREF_HOST, OPENALEX_HOST } from '../allowlist';
import { reconstructAbstract, searchTopics } from '../topic-search';
import type { FetchLike, HttpResponse } from '../types';

function ok(value: unknown): HttpResponse {
  return { ok: true, status: 200, json: async () => value };
}

function throwingJson(): HttpResponse {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token in JSON');
    },
  };
}

interface Routed {
  fetchImpl: FetchLike;
  calls: string[];
}

function routedFetch(openAlex: HttpResponse, crossref: HttpResponse): Routed {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    if (url.includes(OPENALEX_HOST)) {
      return openAlex;
    }
    if (url.includes(CROSSREF_HOST)) {
      return crossref;
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

function openAlexBody(works: unknown[]): HttpResponse {
  return ok({ results: works });
}

function crossrefBody(items: unknown[]): HttpResponse {
  return ok({ message: { items } });
}

const CROSSREF_ITEM = {
  title: ['A comparator trial of brief interventions'],
  DOI: '10.2/xyz',
  issued: { 'date-parts': [[2023]] },
  'container-title': ['Journal of Wellbeing Science'],
};

describe('reconstructAbstract', () => {
  it('inverts an OpenAlex inverted index back into ordered text', () => {
    expect(reconstructAbstract({ A: [0], brief: [1], mindfulness: [2], study: [3] })).toBe('A brief mindfulness study');
  });

  it('places a word at every position it occurs', () => {
    expect(reconstructAbstract({ the: [0, 2], cat: [1], sat: [3] })).toBe('the cat the sat');
  });

  it('returns undefined for a missing or empty index', () => {
    expect(reconstructAbstract(undefined)).toBeUndefined();
    expect(reconstructAbstract({})).toBeUndefined();
  });

  it('caps a very long abstract at 1500 characters', () => {
    const index: Record<string, number[]> = {};
    for (let i = 0; i < 1000; i += 1) {
      index[`word${i}`] = [i];
    }
    const abstract = reconstructAbstract(index);
    expect(abstract).toBeDefined();
    expect((abstract ?? '').length).toBeLessThanOrEqual(1500);
  });
});

describe('searchTopics', () => {
  it('parses OpenAlex works, reconstructing abstracts and keeping citation counts', async () => {
    const work = {
      id: 'https://openalex.org/W1',
      title: 'Brief mindfulness and student wellbeing',
      publication_year: 2024,
      doi: 'https://doi.org/10.1/abc',
      cited_by_count: 42,
      abstract_inverted_index: { A: [0], brief: [1], trial: [2] },
    };
    const { fetchImpl } = routedFetch(openAlexBody([work]), crossrefBody([]));
    const results = await searchTopics(['brief mindfulness wellbeing'], fetchImpl, { maxQueries: 5 });
    const openAlex = results.find((entry) => entry.source === 'openalex');
    expect(openAlex?.items).toHaveLength(1);
    expect(openAlex?.items[0]).toMatchObject({
      title: 'Brief mindfulness and student wellbeing',
      year: 2024,
      doi: 'https://doi.org/10.1/abc',
      citedByCount: 42,
      abstract: 'A brief trial',
    });
  });

  it('parses Crossref items into title, year, doi, and venue', async () => {
    const { fetchImpl } = routedFetch(openAlexBody([]), crossrefBody([CROSSREF_ITEM]));
    const results = await searchTopics(['brief interventions'], fetchImpl, { maxQueries: 5 });
    const crossref = results.find((entry) => entry.source === 'crossref');
    expect(crossref?.items[0]).toMatchObject({
      title: 'A comparator trial of brief interventions',
      year: 2023,
      doi: '10.2/xyz',
      venue: 'Journal of Wellbeing Science',
    });
  });

  it('degrades a malformed-JSON host to an empty list without throwing the other host away', async () => {
    const { fetchImpl } = routedFetch(throwingJson(), crossrefBody([CROSSREF_ITEM]));
    const results = await searchTopics(['brief interventions'], fetchImpl, { maxQueries: 5 });
    const openAlex = results.find((entry) => entry.source === 'openalex');
    const crossref = results.find((entry) => entry.source === 'crossref');
    expect(openAlex?.items).toEqual([]);
    expect(crossref?.items).toHaveLength(1);
  });

  it('never throws when the supplied fetch rejects for a host', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      throw new Error('egress blocked: the query overlaps the protected manuscript corpus');
    };
    const results = await searchTopics(['blocked query'], fetchImpl, { maxQueries: 5 });
    expect(results).toHaveLength(2);
    expect(results.every((entry) => entry.items.length === 0)).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('surfaces a rate-limited host as an http error status instead of a silently empty result', async () => {
    const tooMany: HttpResponse = { ok: false, status: 429, json: async () => ({}) };
    const { fetchImpl } = routedFetch(tooMany, crossrefBody([CROSSREF_ITEM]));
    const results = await searchTopics(['brief interventions'], fetchImpl, { maxQueries: 5 });
    const openAlex = results.find((entry) => entry.source === 'openalex');
    const crossref = results.find((entry) => entry.source === 'crossref');
    expect(openAlex?.items).toEqual([]);
    expect(openAlex?.status).toBe('http error 429');
    expect(crossref?.status).toBe('ok');
  });

  it('spaces same-host requests through the rate limiter', async () => {
    const acquired: string[] = [];
    const limiter = {
      acquire: async (host: string) => {
        acquired.push(host);
      },
    };
    const { fetchImpl } = routedFetch(openAlexBody([]), crossrefBody([]));
    await searchTopics(['one', 'two'], fetchImpl, { maxQueries: 5, rateLimiter: limiter });
    expect(acquired.filter((host) => host === OPENALEX_HOST)).toHaveLength(2);
    expect(acquired.filter((host) => host === CROSSREF_HOST)).toHaveLength(2);
  });

  it('enforces the maxQueries cap and runs only the supplied fetch', async () => {
    const { fetchImpl, calls } = routedFetch(openAlexBody([]), crossrefBody([]));
    const results = await searchTopics(['one', 'two', 'three'], fetchImpl, { maxQueries: 1 });
    expect(results.map((entry) => entry.query)).toEqual(['one', 'one']);
    expect(calls.every((url) => url.includes(OPENALEX_HOST) || url.includes(CROSSREF_HOST))).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('keeps at most perQueryPerSource results per host', async () => {
    const works = Array.from({ length: 5 }, (_unused, index) => ({
      title: `Work ${index}`,
      publication_year: 2020 + index,
    }));
    const { fetchImpl } = routedFetch(openAlexBody(works), crossrefBody([]));
    const results = await searchTopics(['brief interventions'], fetchImpl, { maxQueries: 5, perQueryPerSource: 2 });
    const openAlex = results.find((entry) => entry.source === 'openalex');
    expect(openAlex?.items).toHaveLength(2);
  });

  it('never references a global fetch or imports node-fetch', () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'topic-search.ts'), 'utf8');
    expect(source.includes('node-fetch')).toBe(false);
    expect(/[^A-Za-z0-9_.]fetch\s*\(/.test(source)).toBe(false);
  });
});
