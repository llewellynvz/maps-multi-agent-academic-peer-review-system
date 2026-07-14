import type { SectionMap } from '@mara/shared';
import { normalizeText } from '../citations/text';

export const DEFAULT_NGRAM_SIZE = 8;

export interface NgramIndex {
  size: number;
  grams: ReadonlySet<string>;
}

function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized === '' ? [] : normalized.split(' ');
}

function grams(tokens: string[], size: number): string[] {
  if (tokens.length < size) {
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i + size <= tokens.length; i += 1) {
    out.push(tokens.slice(i, i + size).join(' '));
  }
  return out;
}

export function protectedCorpusText(sectionMap: SectionMap): string {
  const parts: string[] = [];
  if (sectionMap.title !== null) {
    parts.push(sectionMap.title);
  }
  if (sectionMap.abstract !== null) {
    parts.push(sectionMap.abstract);
  }
  for (const section of sectionMap.sections) {
    parts.push(section.text);
  }
  return parts.join('\n');
}

export function buildNgramIndex(text: string, size: number = DEFAULT_NGRAM_SIZE): NgramIndex {
  return { size, grams: new Set(grams(tokenize(text), size)) };
}

export function buildProtectedCorpus(sectionMap: SectionMap, size: number = DEFAULT_NGRAM_SIZE): NgramIndex {
  return buildNgramIndex(protectedCorpusText(sectionMap), size);
}

export function sharedNgram(query: string, index: NgramIndex): string | null {
  for (const gram of grams(tokenize(query), index.size)) {
    if (index.grams.has(gram)) {
      return gram;
    }
  }
  return null;
}
