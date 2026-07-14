import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const envRoot = process.env.MARA_ROOT_DIR;
export const repoRoot =
  envRoot !== undefined && envRoot !== ''
    ? resolve(envRoot)
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function dataDir(): string {
  return resolve(repoRoot, 'data');
}

export function maraDbPath(): string {
  return resolve(dataDir(), 'mara.db');
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
