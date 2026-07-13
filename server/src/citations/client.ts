import { createGuardedFetch } from './allowlist';
import { createCrossrefBackend, createOpenAlexBackend, createSemanticScholarBackend } from './backends';
import { type CitationCache, openCitationCache } from './cache';
import { createRateLimiter, type RateLimiter } from './rate-limiter';
import { scoreCandidate } from './scoring';
import type { CitationBackend, CitationCandidate, FetchLike, Reference, VerifyReferenceResult } from './types';

export interface CitationClientOptions {
  fetchImpl?: FetchLike;
  cache?: CitationCache | null;
  rateLimiter?: RateLimiter;
  backends?: CitationBackend[];
  contactEmail?: string;
  openAlexApiKey?: string;
  semanticScholarApiKey?: string;
  cachePath?: string;
  ttlMs?: number;
}

export interface CitationClient {
  verifyReference: (reference: Reference) => Promise<VerifyReferenceResult>;
  close: () => void;
}

const globalFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status, json: (): Promise<unknown> => response.json() };
};

function buildResult(
  status: 'verified' | 'mismatch',
  source: CitationBackend['source'],
  candidateTitle: string,
  candidateDoi: string | undefined,
  confidence: number,
): VerifyReferenceResult {
  const result: VerifyReferenceResult = { status, source, confidence, matchedTitle: candidateTitle };
  if (candidateDoi !== undefined) {
    result.matchedDoi = candidateDoi;
  }
  return result;
}

export function createCitationClient(options: CitationClientOptions = {}): CitationClient {
  const fetchImpl = options.fetchImpl ?? globalFetch;
  const rateLimiter = options.rateLimiter ?? createRateLimiter();
  const guardedFetch = createGuardedFetch(fetchImpl, rateLimiter);
  const backends =
    options.backends ??
    [
      createCrossrefBackend({ contactEmail: options.contactEmail }),
      createOpenAlexBackend({ contactEmail: options.contactEmail, apiKey: options.openAlexApiKey }),
      createSemanticScholarBackend({ apiKey: options.semanticScholarApiKey }),
    ];

  const ownsCache = options.cache === undefined;
  const cache = options.cache === null ? null : (options.cache ?? openCitationCache({ path: options.cachePath, ttlMs: options.ttlMs }));

  return {
    verifyReference: async (reference: Reference): Promise<VerifyReferenceResult> => {
      if (cache !== null) {
        const hit = cache.get(reference);
        if (hit !== undefined) {
          return hit;
        }
      }

      let verified: VerifyReferenceResult | null = null;
      let bestMismatch: VerifyReferenceResult | null = null;

      for (const backend of backends) {
        let candidates: CitationCandidate[];
        try {
          candidates = await backend.lookup(reference, guardedFetch);
        } catch {
          candidates = [];
        }
        for (const candidate of candidates) {
          const scored = scoreCandidate(reference, candidate);
          if (scored.status === 'verified') {
            const result = buildResult('verified', backend.source, candidate.title, candidate.doi, scored.confidence);
            if (verified === null || result.confidence > verified.confidence) {
              verified = result;
            }
          } else if (scored.status === 'mismatch') {
            const result = buildResult('mismatch', backend.source, candidate.title, candidate.doi, scored.confidence);
            if (bestMismatch === null || result.confidence > bestMismatch.confidence) {
              bestMismatch = result;
            }
          }
        }
        if (verified !== null) {
          break;
        }
      }

      const result: VerifyReferenceResult =
        verified ?? bestMismatch ?? { status: 'not_found', source: null, confidence: 0 };

      if (cache !== null) {
        cache.set(reference, result.source, result);
      }
      return result;
    },
    close: (): void => {
      if (ownsCache && cache !== null) {
        cache.close();
      }
    },
  };
}
