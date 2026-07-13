export {
  ALLOWED_HOSTS,
  assertAllowedHost,
  createGuardedFetch,
  CROSSREF_HOST,
  OPENALEX_HOST,
  SEMANTIC_SCHOLAR_HOST,
} from './allowlist';
export { createCrossrefBackend, createOpenAlexBackend, createSemanticScholarBackend } from './backends';
export {
  cacheKey,
  type CitationCache,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_CITATION_CACHE_PATH,
  openCitationCache,
  type OpenCacheOptions,
} from './cache';
export { type CitationClient, type CitationClientOptions, createCitationClient } from './client';
export { createRateLimiter, type RateLimiter, type RateLimiterOptions } from './rate-limiter';
export { type CandidateScore, scoreCandidate } from './scoring';
export { normalizeDoi, normalizeText, titleSimilarity } from './text';
export type {
  CitationBackend,
  CitationCandidate,
  CitationSource,
  CitationStatus,
  FetchLike,
  HttpResponse,
  Reference,
  VerifyReferenceResult,
} from './types';
