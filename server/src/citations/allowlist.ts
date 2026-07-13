import type { FetchLike } from './types';
import type { RateLimiter } from './rate-limiter';

export const CROSSREF_HOST = 'api.crossref.org';
export const OPENALEX_HOST = 'api.openalex.org';
export const SEMANTIC_SCHOLAR_HOST = 'api.semanticscholar.org';

export const ALLOWED_HOSTS: ReadonlySet<string> = new Set([CROSSREF_HOST, OPENALEX_HOST, SEMANTIC_SCHOLAR_HOST]);

export function assertAllowedHost(url: string): string {
  const hostname = new URL(url).hostname;
  if (!ALLOWED_HOSTS.has(hostname)) {
    throw new Error(`Citation egress blocked: ${hostname} is not on the allowlist`);
  }
  return hostname;
}

export function createGuardedFetch(fetchImpl: FetchLike, rateLimiter: RateLimiter): FetchLike {
  return async (url, init) => {
    const hostname = assertAllowedHost(url);
    await rateLimiter.acquire(hostname);
    return fetchImpl(url, init);
  };
}
