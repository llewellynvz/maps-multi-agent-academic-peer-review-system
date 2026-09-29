import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './env-aliases';

const envRoot = process.env.MAPS_ROOT_DIR;
export const repoRoot =
  envRoot !== undefined && envRoot !== ''
    ? resolve(envRoot)
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function dataDir(): string {
  return resolve(repoRoot, 'data');
}

// New installs use maps.db. An installation created before the rename keeps its mara.db, which is used
// as long as it exists and no maps.db has been created beside it, so no review data is stranded.
export function mapsDbPath(): string {
  const current = resolve(dataDir(), 'maps.db');
  const legacy = resolve(dataDir(), 'mara.db');
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}

export function mastraDbPath(): string {
  return resolve(dataDir(), 'mastra.db');
}

export function citationCachePath(): string {
  return resolve(dataDir(), 'citation-cache.db');
}

export function blobDir(reviewId: string): string {
  return resolve(dataDir(), 'blobs', reviewId);
}

export function fixturesDir(): string {
  return resolve(dataDir(), 'fixtures');
}

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}
