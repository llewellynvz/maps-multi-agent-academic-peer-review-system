import { existsSync } from 'node:fs';
import { type ParseQuality, type SectionMap, sectionMapSchema } from '@mara/shared';
import type { Reference } from '../citations';
import type { MaraDatabase } from '../db/client';
import { isPublishedReference } from '../security';
import { getReviewOptions } from '../workflow/repo';
import { manuscriptBlobPath, readManuscriptBlobText } from '../workflow/storage';
import { normalisePreset, type Preset } from './lenses';

const SECTION_MAP_BLOB = 'parse/section-map.json';
const SANITIZED_SECTION_MAP_BLOB = 'parse/section-map.sanitized.json';

const DIGEST_LIMITS: Record<Preset, { digestChars: number; sectionChars: number }> = {
  fast: { digestChars: 16000, sectionChars: 2400 },
  balanced: { digestChars: 16000, sectionChars: 2400 },
  thorough: { digestChars: 32000, sectionChars: 4800 },
};
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

export function manuscriptDigest(sectionMap: SectionMap, preset: Preset = 'balanced'): string {
  const limits = DIGEST_LIMITS[preset];
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
    parts.push(`## ${heading} (${anchor})\n${section.text.slice(0, limits.sectionChars)}`);
  }
  return parts.join('\n\n').slice(0, limits.digestChars);
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

export type ReferenceAuditMode = 'standard' | 'forensic';

export interface ReferenceSkip {
  reference: string;
  reason: string;
}

export interface ReferenceSelection {
  references: Array<Reference & { index: number }>;
  skipped: ReferenceSkip[];
}

export function referencesForVerification(sectionMap: SectionMap, mode: ReferenceAuditMode): ReferenceSelection {
  const references: Array<Reference & { index: number }> = [];
  const skipped: ReferenceSkip[] = [];
  for (const reference of sectionMap.references) {
    if (reference.title === null || reference.title.trim().length < 6) {
      continue;
    }
    if (!isPublishedReference(reference)) {
      continue;
    }
    if (mode === 'standard' && references.length >= REFERENCE_CAP) {
      skipped.push({ reference: reference.title, reason: 'standard-cap' });
      continue;
    }
    references.push({
      index: reference.index,
      title: reference.title,
      authors: reference.authors,
      year: reference.year ?? 0,
      ...(reference.doi !== null ? { doi: reference.doi } : {}),
    });
  }
  return { references, skipped };
}
