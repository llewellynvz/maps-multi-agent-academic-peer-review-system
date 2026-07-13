export type CitationStatus = 'verified' | 'not_found' | 'mismatch';

export type CitationSource = 'crossref' | 'openalex' | 'semantic_scholar';

export interface Reference {
  title: string;
  authors: string[];
  year: number;
  doi?: string;
}

export interface VerifyReferenceResult {
  status: CitationStatus;
  source: CitationSource | null;
  matchedDoi?: string;
  matchedTitle?: string;
  confidence: number;
}

export interface CitationCandidate {
  title: string;
  doi?: string;
  year?: number;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<HttpResponse>;

export interface CitationBackend {
  source: CitationSource;
  host: string;
  lookup: (reference: Reference, fetchImpl: FetchLike) => Promise<CitationCandidate[]>;
}
