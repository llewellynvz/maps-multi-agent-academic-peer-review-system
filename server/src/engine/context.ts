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

const DIGEST_LIMITS: Record<Preset, { digestChars: number }> = {
  fast: { digestChars: 24000 },
  balanced: { digestChars: 64000 },
  thorough: { digestChars: 150000 },
};
const SECTION_FLOOR_CHARS = 200;
const TRUNCATION_MARKER = ' [section truncated]';

// Cap for dispatches that carry the digest ON TOP OF the full ledger, report, and swarm
// (the Phase 7 synthesis agents). Those agents work from the findings, not the raw text, so a
// bounded excerpt keeps the largest prompt well inside the model context window.
export const SYNTHESIS_DIGEST_CHARS = 48000;
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

function allocateSectionBudgets(lengths: number[], budget: number): number[] {
  if (lengths.length === 0) {
    return [];
  }
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= budget) {
    return lengths.slice();
  }
  const floor = Math.min(SECTION_FLOOR_CHARS, Math.floor(budget / lengths.length));
  const overflow = lengths.reduce((sum, length) => sum + Math.max(0, length - floor), 0);
  const remaining = Math.max(0, budget - floor * lengths.length);
  return lengths.map((length) => {
    const base = Math.min(length, floor);
    const share = overflow > 0 ? Math.floor((remaining * Math.max(0, length - floor)) / overflow) : 0;
    return Math.min(length, base + share);
  });
}

export function manuscriptDigest(sectionMap: SectionMap, preset: Preset = 'balanced', maxChars?: number): string {
  const budgetTotal =
    maxChars !== undefined ? Math.min(DIGEST_LIMITS[preset].digestChars, maxChars) : DIGEST_LIMITS[preset].digestChars;
  const header: string[] = [];
  if (sectionMap.title !== null) {
    header.push(`Title: ${sectionMap.title}`);
  }
  if (sectionMap.abstract !== null) {
    header.push(`Abstract: ${sectionMap.abstract}`);
  }

  const rendered = sectionMap.sections.map((section) => {
    const heading = section.heading ?? `Section ${section.index}`;
    const label = `## ${heading} (lines ${section.lineStart}-${section.lineEnd})`;
    return { label, text: section.text };
  });

  const headerText = header.join('\n\n');
  // Each rendered part is `label\nbody`, and parts join with `\n\n`, so the non-body cost per part
  // is label.length + 3. Undercounting it lets the final hard clamp trim a real section's tail.
  const overhead = rendered.reduce((sum, part) => sum + part.label.length + 3, 0);
  const budget = Math.max(0, budgetTotal - headerText.length - overhead);
  const allocations = allocateSectionBudgets(
    rendered.map((part) => part.text.length),
    budget,
  );

  const bodyParts = rendered.map((part, index) => {
    const limit = allocations[index] ?? 0;
    const body =
      part.text.length <= limit
        ? part.text
        : `${part.text.slice(0, Math.max(0, limit - TRUNCATION_MARKER.length)).trimEnd()}${TRUNCATION_MARKER}`;
    return `${part.label}\n${body}`;
  });

  return [...header, ...bodyParts].join('\n\n').slice(0, budgetTotal);
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
