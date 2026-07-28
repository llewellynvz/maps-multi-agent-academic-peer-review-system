import { CROSSREF_HOST, OPENALEX_HOST, SEMANTIC_SCHOLAR_HOST } from './allowlist';
import type { CitationBackend, CitationCandidate, FetchLike, Reference } from './types';

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

function collectCandidates(
  items: unknown[],
  parse: (record: Record<string, unknown>) => CitationCandidate | undefined,
): CitationCandidate[] {
  const candidates: CitationCandidate[] = [];
  for (const raw of items) {
    const record = asRecord(raw);
    if (record === undefined) {
      continue;
    }
    const candidate = parse(record);
    if (candidate !== undefined) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

export class CitationBackendOutage extends Error {
  readonly status: number;

  constructor(host: string, status: number) {
    super(`citation backend unavailable: ${host} returned ${status}`);
    this.name = 'CitationBackendOutage';
    this.status = status;
  }
}

// A rate-limited or erroring backend is not evidence that a reference does not exist. Collapsing both
// into "no candidates" is what lets a throttling window cache as not_found, and phase 4 reads a
// not_found as a possible fabrication. Only an authoritative answer may be treated as absence.
function isOutageStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function readJson(fetchImpl: FetchLike, url: string, headers?: Record<string, string>): Promise<unknown> {
  const response = await fetchImpl(url, headers ? { headers } : undefined);
  if (!response.ok) {
    if (isOutageStatus(response.status)) {
      throw new CitationBackendOutage(new URL(url).host, response.status);
    }
    return undefined;
  }
  try {
    return await response.json();
  } catch {
    return undefined;
  }
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

function crossrefCandidate(item: Record<string, unknown>): CitationCandidate | undefined {
  const title = asString(asArray(item.title)[0]);
  if (title === undefined) {
    return undefined;
  }
  return { title, doi: asString(item.DOI), year: crossrefYear(item) };
}

export function createCrossrefBackend(config: { contactEmail?: string } = {}): CitationBackend {
  return {
    source: 'crossref',
    host: CROSSREF_HOST,
    lookup: async (reference: Reference, fetchImpl: FetchLike): Promise<CitationCandidate[]> => {
      if (reference.doi !== undefined) {
        const url = new URL(`https://${CROSSREF_HOST}/works/${encodeURIComponent(reference.doi)}`);
        if (config.contactEmail !== undefined) {
          url.searchParams.set('mailto', config.contactEmail);
        }
        const message = asRecord(asRecord(await readJson(fetchImpl, url.toString()))?.message);
        const candidate = message ? crossrefCandidate(message) : undefined;
        if (candidate !== undefined) {
          return [candidate];
        }
      }
      const url = new URL(`https://${CROSSREF_HOST}/works`);
      url.searchParams.set('query.bibliographic', reference.title);
      if (reference.authors.length > 0) {
        url.searchParams.set('query.author', reference.authors.join(' '));
      }
      url.searchParams.set('rows', '5');
      url.searchParams.set('select', 'DOI,title,published,issued');
      if (config.contactEmail !== undefined) {
        url.searchParams.set('mailto', config.contactEmail);
      }
      const items = asArray(asRecord(asRecord(await readJson(fetchImpl, url.toString()))?.message)?.items);
      return collectCandidates(items, crossrefCandidate);
    },
  };
}

function openAlexCandidate(work: Record<string, unknown>): CitationCandidate | undefined {
  const title = asString(work.title) ?? asString(work.display_name);
  if (title === undefined) {
    return undefined;
  }
  return { title, doi: asString(work.doi), year: asNumber(work.publication_year) };
}

export function createOpenAlexBackend(config: { contactEmail?: string; apiKey?: string } = {}): CitationBackend {
  const decorate = (url: URL): void => {
    if (config.contactEmail !== undefined) {
      url.searchParams.set('mailto', config.contactEmail);
    }
    if (config.apiKey !== undefined) {
      url.searchParams.set('api_key', config.apiKey);
    }
  };
  return {
    source: 'openalex',
    host: OPENALEX_HOST,
    lookup: async (reference: Reference, fetchImpl: FetchLike): Promise<CitationCandidate[]> => {
      if (reference.doi !== undefined) {
        const byDoi = new URL(`https://${OPENALEX_HOST}/works`);
        byDoi.searchParams.set('filter', `doi:${reference.doi}`);
        byDoi.searchParams.set('per-page', '1');
        decorate(byDoi);
        const found = collectCandidates(
          asArray(asRecord(await readJson(fetchImpl, byDoi.toString()))?.results),
          openAlexCandidate,
        );
        if (found.length > 0) {
          return found;
        }
      }
      const url = new URL(`https://${OPENALEX_HOST}/works`);
      url.searchParams.set('search', [reference.title, ...reference.authors].join(' '));
      url.searchParams.set('per-page', '5');
      decorate(url);
      const results = asArray(asRecord(await readJson(fetchImpl, url.toString()))?.results);
      return collectCandidates(results, openAlexCandidate);
    },
  };
}

function semanticScholarCandidate(paper: Record<string, unknown>): CitationCandidate | undefined {
  const title = asString(paper.title);
  if (title === undefined) {
    return undefined;
  }
  const externalIds = asRecord(paper.externalIds);
  return { title, doi: externalIds ? asString(externalIds.DOI) : undefined, year: asNumber(paper.year) };
}

export function createSemanticScholarBackend(config: { apiKey?: string } = {}): CitationBackend {
  const headers = config.apiKey !== undefined ? { 'x-api-key': config.apiKey } : undefined;
  return {
    source: 'semantic_scholar',
    host: SEMANTIC_SCHOLAR_HOST,
    lookup: async (reference: Reference, fetchImpl: FetchLike): Promise<CitationCandidate[]> => {
      if (reference.doi !== undefined) {
        const url = new URL(
          `https://${SEMANTIC_SCHOLAR_HOST}/graph/v1/paper/DOI:${encodeURIComponent(reference.doi)}`,
        );
        url.searchParams.set('fields', 'title,year,externalIds');
        const paper = asRecord(await readJson(fetchImpl, url.toString(), headers));
        const candidate = paper ? semanticScholarCandidate(paper) : undefined;
        if (candidate !== undefined) {
          return [candidate];
        }
      }
      const url = new URL(`https://${SEMANTIC_SCHOLAR_HOST}/graph/v1/paper/search`);
      url.searchParams.set('query', reference.title);
      url.searchParams.set('fields', 'title,year,externalIds');
      url.searchParams.set('limit', '5');
      const data = asArray(asRecord(await readJson(fetchImpl, url.toString(), headers))?.data);
      return collectCandidates(data, semanticScholarCandidate);
    },
  };
}
