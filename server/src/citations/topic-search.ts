import { CROSSREF_HOST, OPENALEX_HOST } from './allowlist';
import type { FetchLike } from './types';

export interface TopicSearchItem {
  title: string;
  year: number | null;
  doi: string | null;
  venue?: string;
  citedByCount?: number;
  abstract?: string;
}

export interface TopicSearchResult {
  query: string;
  source: 'openalex' | 'crossref';
  items: TopicSearchItem[];
}

export interface TopicSearchOptions {
  maxQueries: number;
  perQueryPerSource?: number;
}

const DEFAULT_PER_QUERY_PER_SOURCE = 5;
const ABSTRACT_CHAR_CAP = 1500;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function readJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    return undefined;
  }
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function reconstructAbstract(index: unknown): string | undefined {
  const record = asRecord(index);
  if (record === undefined) {
    return undefined;
  }
  const words: Array<{ position: number; word: string }> = [];
  for (const [word, positions] of Object.entries(record)) {
    for (const raw of asArray(positions)) {
      const position = asNumber(raw);
      if (position !== undefined && Number.isInteger(position) && position >= 0) {
        words.push({ position, word });
      }
    }
  }
  if (words.length === 0) {
    return undefined;
  }
  words.sort((a, b) => a.position - b.position);
  const text = words.map((entry) => entry.word).join(' ');
  return text.length > ABSTRACT_CHAR_CAP ? text.slice(0, ABSTRACT_CHAR_CAP) : text;
}

function openAlexItem(work: Record<string, unknown>): TopicSearchItem | undefined {
  const title = asString(work.title) ?? asString(work.display_name);
  if (title === undefined) {
    return undefined;
  }
  const item: TopicSearchItem = {
    title,
    year: asNumber(work.publication_year) ?? null,
    doi: asString(work.doi) ?? null,
  };
  const citedBy = asNumber(work.cited_by_count);
  if (citedBy !== undefined) {
    item.citedByCount = citedBy;
  }
  const abstract = reconstructAbstract(work.abstract_inverted_index);
  if (abstract !== undefined) {
    item.abstract = abstract;
  }
  return item;
}

function crossrefYear(item: Record<string, unknown>): number | undefined {
  for (const key of ['published', 'issued', 'published-print', 'published-online']) {
    const parts = asRecord(item[key])?.['date-parts'];
    const first = asArray(parts)[0];
    const year = asNumber(asArray(first)[0]);
    if (year !== undefined) {
      return year;
    }
  }
  return undefined;
}

function crossrefItem(item: Record<string, unknown>): TopicSearchItem | undefined {
  const title = asString(asArray(item.title)[0]);
  if (title === undefined) {
    return undefined;
  }
  const result: TopicSearchItem = {
    title,
    year: crossrefYear(item) ?? null,
    doi: asString(item.DOI) ?? null,
  };
  const venue = asString(asArray(item['container-title'])[0]);
  if (venue !== undefined) {
    result.venue = venue;
  }
  return result;
}

function collect(
  items: unknown[],
  parse: (record: Record<string, unknown>) => TopicSearchItem | undefined,
  keep: number,
): TopicSearchItem[] {
  const out: TopicSearchItem[] = [];
  for (const raw of items) {
    if (out.length >= keep) {
      break;
    }
    const record = asRecord(raw);
    if (record === undefined) {
      continue;
    }
    const item = parse(record);
    if (item !== undefined) {
      out.push(item);
    }
  }
  return out;
}

async function searchOpenAlex(query: string, fetchImpl: FetchLike, keep: number): Promise<TopicSearchItem[]> {
  try {
    const url = new URL(`https://${OPENALEX_HOST}/works`);
    url.searchParams.set('search', query);
    url.searchParams.set('per-page', '5');
    url.searchParams.set(
      'select',
      'id,title,display_name,publication_year,doi,abstract_inverted_index,cited_by_count',
    );
    const results = asArray(asRecord(await readJson(fetchImpl, url.toString()))?.results);
    return collect(results, openAlexItem, keep);
  } catch {
    return [];
  }
}

async function searchCrossref(query: string, fetchImpl: FetchLike, keep: number): Promise<TopicSearchItem[]> {
  try {
    const url = new URL(`https://${CROSSREF_HOST}/works`);
    url.searchParams.set('query.bibliographic', query);
    url.searchParams.set('rows', '5');
    url.searchParams.set('select', 'DOI,title,published,issued,author,container-title');
    const items = asArray(asRecord(asRecord(await readJson(fetchImpl, url.toString()))?.message)?.items);
    return collect(items, crossrefItem, keep);
  } catch {
    return [];
  }
}

export async function searchTopics(
  queries: string[],
  fetchImpl: FetchLike,
  opts: TopicSearchOptions,
): Promise<TopicSearchResult[]> {
  const keep = opts.perQueryPerSource ?? DEFAULT_PER_QUERY_PER_SOURCE;
  const limited = queries.slice(0, opts.maxQueries);
  const results: TopicSearchResult[] = [];
  for (const query of limited) {
    const [openalex, crossref] = await Promise.all([
      searchOpenAlex(query, fetchImpl, keep),
      searchCrossref(query, fetchImpl, keep),
    ]);
    results.push({ query, source: 'openalex', items: openalex });
    results.push({ query, source: 'crossref', items: crossref });
  }
  return results;
}
