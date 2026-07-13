import { existsSync } from 'node:fs';
import { type ParseQuality, type SectionMap, sectionMapSchema } from '@mara/shared';
import type { Reference } from '../citations';
import type { MaraDatabase } from '../db/client';
import { getReviewOptions } from '../workflow/repo';
import { manuscriptBlobPath, readManuscriptBlobText } from '../workflow/storage';
import { normalisePreset, type Preset } from './lenses';

const SECTION_MAP_BLOB = 'parse/section-map.json';
const SANITIZED_SECTION_MAP_BLOB = 'parse/section-map.sanitized.json';

const MANUSCRIPT_DIGEST_CHARS = 16000;
const SECTION_CHARS = 2400;
const REFERENCE_CAP = 20;

export interface EngineContext {
  sectionMap: SectionMap;
  parseQuality: ParseQuality;
  preset: Preset;
}

export function loadSectionMap(reviewId: string): SectionMap {
  const sanitized = manuscriptBlobPath(reviewId, SANITIZED_SECTION_MAP_BLOB);
  const path = existsSync(sanitized) ? SANITIZED_SECTION_MAP_BLOB : SECTION_MAP_BLOB;
  return sectionMapSchema.parse(JSON.parse(readManuscriptBlobText(reviewId, path)));
}

export function loadEngineContext(db: MaraDatabase, reviewId: string): EngineContext {
  const sectionMap = loadSectionMap(reviewId);
  const options = getReviewOptions(db, reviewId);
  return {
    sectionMap,
    parseQuality: sectionMap.parseQuality,
    preset: normalisePreset(options.preset),
  };
}

export function manuscriptDigest(sectionMap: SectionMap): string {
  const parts: string[] = [];
  if (sectionMap.title !== null) {
    parts.push(`Title: ${sectionMap.title}`);
  }
  if (sectionMap.abstract !== null) {
    parts.push(`Abstract: ${sectionMap.abstract}`);
  }
  for (const section of sectionMap.sections) {
    const heading = section.heading ?? `Section ${section.index}`;
    const anchor = `lines ${section.lineStart}-${section.lineEnd}`;
    parts.push(`## ${heading} (${anchor})\n${section.text.slice(0, SECTION_CHARS)}`);
  }
  return parts.join('\n\n').slice(0, MANUSCRIPT_DIGEST_CHARS);
}

export function referenceMetadataList(sectionMap: SectionMap): string {
  if (sectionMap.references.length === 0) {
    return 'No references were extracted from the manuscript.';
  }
  return sectionMap.references
    .map((reference) => {
      const authors = reference.authors.length > 0 ? reference.authors.join('; ') : 'authors not extracted';
      const year = reference.year ?? 'year not extracted';
      const doi = reference.doi ?? 'no doi';
      const title = reference.title ?? reference.raw.slice(0, 160);
      return `[${reference.index}] ${title} — ${authors} (${year}) ${doi}`;
    })
    .join('\n');
}

export function referencesForVerification(sectionMap: SectionMap): Array<Reference & { index: number }> {
  const usable: Array<Reference & { index: number }> = [];
  for (const reference of sectionMap.references) {
    if (reference.title === null || reference.title.trim().length < 6) {
      continue;
    }
    usable.push({
      index: reference.index,
      title: reference.title,
      authors: reference.authors,
      year: reference.year ?? 0,
      ...(reference.doi !== null ? { doi: reference.doi } : {}),
    });
    if (usable.length >= REFERENCE_CAP) {
      break;
    }
  }
  return usable;
}
