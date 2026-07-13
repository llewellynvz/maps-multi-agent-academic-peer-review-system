import { existsSync } from 'node:fs';
import { manuscriptBlobPath, readManuscriptBlobText, writeManuscriptBlob } from '../workflow/storage';

function artefactRelativePath(name: string): string {
  return `engine/${name}.json`;
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
