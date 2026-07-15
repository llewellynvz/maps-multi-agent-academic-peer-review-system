import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { manuscriptBlobPath, readManuscriptBlobText, writeManuscriptBlob } from '../workflow/storage';

function artefactRelativePath(name: string): string {
  return `engine/${name}.json`;
}

export function deleteArtefactsByPrefix(reviewId: string, prefix: string): string[] {
  const engineDir = dirname(manuscriptBlobPath(reviewId, artefactRelativePath('any')));
  if (!existsSync(engineDir)) {
    return [];
  }
  const removed: string[] = [];
  for (const file of readdirSync(engineDir)) {
    if (file.startsWith(prefix) && file.endsWith('.json')) {
      unlinkSync(manuscriptBlobPath(reviewId, `engine/${file}`));
      removed.push(file);
    }
  }
  return removed;
}

export function readArtefactsByPrefix(reviewId: string, prefix: string): Array<{ name: string; value: unknown }> {
  const engineDir = dirname(manuscriptBlobPath(reviewId, artefactRelativePath('any')));
  if (!existsSync(engineDir)) {
    return [];
  }
  const entries: Array<{ name: string; value: unknown }> = [];
  for (const file of readdirSync(engineDir)) {
    if (file.startsWith(prefix) && file.endsWith('.json')) {
      entries.push({ name: file.slice(0, -'.json'.length), value: JSON.parse(readManuscriptBlobText(reviewId, `engine/${file}`)) });
    }
  }
  return entries;
}

export function artefactExists(reviewId: string, name: string): boolean {
  return existsSync(manuscriptBlobPath(reviewId, artefactRelativePath(name)));
}

export function writeArtefact(reviewId: string, name: string, value: unknown): void {
  writeManuscriptBlob(reviewId, artefactRelativePath(name), JSON.stringify(value, null, 2));
}

export function readArtefact<T = unknown>(reviewId: string, name: string): T {
  return JSON.parse(readManuscriptBlobText(reviewId, artefactRelativePath(name))) as T;
}
