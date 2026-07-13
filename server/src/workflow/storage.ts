import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { blobDir, repoRoot } from '../paths';

export function manuscriptBlobPath(reviewId: string, relativePath: string): string {
  return resolve(blobDir(reviewId), relativePath);
}

export function toRepoRelative(absolutePath: string): string {
  return relative(repoRoot, absolutePath).split('\\').join('/');
}

export function writeManuscriptBlob(reviewId: string, relativePath: string, data: string | Uint8Array): string {
  const absolute = manuscriptBlobPath(reviewId, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, data);
  return toRepoRelative(absolute);
}

export function readManuscriptBlobText(reviewId: string, relativePath: string): string {
  return readFileSync(manuscriptBlobPath(reviewId, relativePath), 'utf8');
}

export function resolveRepoPath(pathValue: string): string {
  return resolve(repoRoot, pathValue);
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
