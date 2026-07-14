import { createHmac, timingSafeEqual } from 'node:crypto';
import { ALLOWED_HOSTS, CROSSREF_HOST, OPENALEX_HOST, SEMANTIC_SCHOLAR_HOST } from '../citations/allowlist';
import type { CitationSource, FetchLike, HttpResponse } from '../citations/types';
import { type NgramIndex, sharedNgram } from './ngram';

export interface EgressLogEntry {
  target: CitationSource | null;
  query: string;
  signature: string | null;
  blocked: boolean;
  reason: string | null;
}

export type EgressLogger = (entry: EgressLogEntry) => void;

export interface EgressRunContext {
  reviewId: string;
  signingKey: Buffer;
  corpus: NgramIndex;
  log: EgressLogger;
}

export interface EgressController {
  fetch: FetchLike;
  begin: (context: EgressRunContext) => void;
  end: () => void;
  active: () => boolean;
  sign: (url: string) => string;
  sendSigned: (url: string, signature: string, init?: { headers?: Record<string, string> }) => Promise<HttpResponse>;
}

const SIGNATURE_HEX_LENGTH = 64;

export function signQuery(query: string, key: Buffer): string {
  return createHmac('sha256', key).update(query).digest('hex');
}

export function verifyQuery(query: string, signature: string, key: Buffer): boolean {
  if (signature.length !== SIGNATURE_HEX_LENGTH || !/^[0-9a-f]+$/.test(signature)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(signQuery(query, key), 'hex'));
}

const REDACTED_QUERY_PARAMS = new Set(['api_key', 'apikey', 'mailto']);

export function canonicalQuery(url: string): string {
  const parsed = new URL(url);
  for (const key of [...parsed.searchParams.keys()]) {
    if (REDACTED_QUERY_PARAMS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }
  return `${parsed.pathname}${parsed.search}`;
}

const MAX_DECODE_PASSES = 3;

export function decodeForScan(query: string): string[] | null {
  const forms: string[] = [query.replace(/\+/g, ' ')];
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    const current = forms[forms.length - 1] as string;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return pass === 0 ? null : forms;
    }
    if (decoded === current) {
      return forms;
    }
    forms.push(decoded);
  }
  const deepest = forms[forms.length - 1] as string;
  try {
    return decodeURIComponent(deepest) === deepest ? forms : null;
  } catch {
    return forms;
  }
}

export function sourceForHost(host: string): CitationSource | null {
  if (host === CROSSREF_HOST) {
    return 'crossref';
  }
  if (host === OPENALEX_HOST) {
    return 'openalex';
  }
  if (host === SEMANTIC_SCHOLAR_HOST) {
    return 'semantic_scholar';
  }
  return null;
}

const IN_PREPARATION =
  /\b(in\s+preparation|in\s+prep|forthcoming|unpublished|under\s+review|submitted\s+for\s+publication|manuscript\s+submitted|personal\s+communication|working\s+paper)\b/i;

const ISBN_PATTERN = /\bISBN[-\s]?(1[03])?:?\s*[\d][\d\s-]{8,16}[\dX]\b/i;

export interface EgressReference {
  raw?: string;
  title?: string | null;
  doi?: string | null;
  year?: number | null;
  venue?: string | null;
}

export function isPublishedReference(reference: EgressReference): boolean {
  if (IN_PREPARATION.test(reference.raw ?? '')) {
    return false;
  }
  if (typeof reference.doi === 'string' && reference.doi.trim() !== '') {
    return true;
  }
  if (ISBN_PATTERN.test(reference.raw ?? '')) {
    return true;
  }
  const hasYear = typeof reference.year === 'number' && reference.year > 0;
  const hasVenue = typeof reference.venue === 'string' && reference.venue.trim() !== '';
  return hasYear && hasVenue;
}

export function createEgressController(
  baseFetch: FetchLike,
  options: { allowedHosts?: ReadonlySet<string> } = {},
): EgressController {
  const allowed = options.allowedHosts ?? ALLOWED_HOSTS;
  let context: EgressRunContext | null = null;

  const require = (): EgressRunContext => {
    if (context === null) {
      throw new Error('Egress blocked: no active run context, outbound citation requests are refused.');
    }
    return context;
  };

  const sign = (url: string): string => signQuery(canonicalQuery(url), require().signingKey);

  const sendSigned: EgressController['sendSigned'] = async (url, signature, init) => {
    const active = require();
    const query = canonicalQuery(url);
    const host = new URL(url).hostname;
    const target = sourceForHost(host);

    if (!allowed.has(host)) {
      active.log({ target: null, query, signature: null, blocked: true, reason: `host_not_allowlisted:${host}` });
      throw new Error(`Egress blocked: ${host} is not on the allowlist`);
    }
    if (!verifyQuery(query, signature, active.signingKey)) {
      active.log({ target, query, signature: null, blocked: true, reason: 'unsigned' });
      throw new Error('Egress blocked: the query signature is missing or invalid');
    }
    const scanForms = decodeForScan(query);
    if (scanForms === null) {
      active.log({ target, query, signature, blocked: true, reason: 'undecodable' });
      throw new Error('Egress blocked: the query percent-encoding is malformed');
    }
    for (const form of scanForms) {
      if (sharedNgram(form, active.corpus) !== null) {
        active.log({ target, query, signature, blocked: true, reason: 'ngram' });
        throw new Error('Egress blocked: the query overlaps the protected manuscript corpus');
      }
    }
    active.log({ target, query, signature, blocked: false, reason: null });
    return baseFetch(url, init);
  };

  const fetch: FetchLike = async (url, init) => sendSigned(url, sign(url), init);

  return {
    fetch,
    begin: (next) => {
      context = next;
    },
    end: () => {
      context = null;
    },
    active: () => context !== null,
    sign,
    sendSigned,
  };
}
