import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import { normalizeDoi, normalizeText } from './text';
import type { CitationSource, Reference, VerifyReferenceResult } from './types';

export const DEFAULT_CITATION_CACHE_PATH = resolve(process.cwd(), 'data', 'citation-cache.db');
export const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CitationCache {
  get: (reference: Reference, atMs?: number) => VerifyReferenceResult | undefined;
  set: (reference: Reference, source: CitationSource | null, result: VerifyReferenceResult) => void;
  close: () => void;
}

export function cacheKey(reference: Reference): string {
  const doi = reference.doi === undefined ? '' : normalizeDoi(reference.doi);
  const authors = reference.authors.map((author) => normalizeText(author)).join(',');
  return [normalizeText(reference.title), reference.year, doi, authors].join('|');
}

export interface OpenCacheOptions {
  path?: string;
  ttlMs?: number;
}

export function openCitationCache(options: OpenCacheOptions = {}): CitationCache {
  const path = options.path ?? DEFAULT_CITATION_CACHE_PATH;
  const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseConstructor(path);
  db.pragma('journal_mode = WAL');
  db.exec(
    `CREATE TABLE IF NOT EXISTS citation_cache (
      query_key TEXT PRIMARY KEY,
      source TEXT,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    )`,
  );

  db.prepare('DELETE FROM citation_cache WHERE fetched_at < ?').run(new Date(Date.now() - ttlMs).toISOString());

  const selectStmt = db.prepare('SELECT payload_json, fetched_at FROM citation_cache WHERE query_key = ?');
  const upsertStmt = db.prepare(
    `INSERT INTO citation_cache (query_key, source, payload_json, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(query_key) DO UPDATE SET
       source = excluded.source,
       payload_json = excluded.payload_json,
       fetched_at = excluded.fetched_at`,
  );

  return {
    get: (reference, atMs) => {
      const row = selectStmt.get(cacheKey(reference)) as { payload_json: string; fetched_at: string } | undefined;
      if (row === undefined) {
        return undefined;
      }
      const fetchedAt = Date.parse(row.fetched_at);
      const current = atMs ?? Date.now();
      if (Number.isNaN(fetchedAt) || current - fetchedAt > ttlMs) {
        return undefined;
      }
      return JSON.parse(row.payload_json) as VerifyReferenceResult;
    },
    set: (reference, source, result) => {
      upsertStmt.run(cacheKey(reference), source, JSON.stringify(result), new Date().toISOString());
    },
    close: () => {
      db.close();
    },
  };
}
