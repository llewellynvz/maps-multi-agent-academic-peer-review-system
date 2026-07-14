import { XMLParser } from 'fast-xml-parser';
import type { ManuscriptReference, SectionMap } from '@mara/shared';
import { assembleSectionMap, type RawSection } from './assemble';
import { normalizeInline } from './text';

type XmlNode = string | number | boolean | null | undefined | XmlNode[] | { [key: string]: XmlNode };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

function asArray(value: XmlNode): XmlNode[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: XmlNode): value is { [key: string]: XmlNode } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(node: XmlNode): string {
  if (node === undefined || node === null) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join(' ');
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@_')) {
      continue;
    }
    parts.push(textOf(value));
  }
  return parts.join(' ');
}

function findFirst(node: XmlNode, target: string): XmlNode {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirst(item, target);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === target) {
        return value;
      }
      const found = findFirst(value, target);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

function pickMainTitle(titleNode: XmlNode): string | null {
  const titles = asArray(titleNode);
  if (titles.length === 0) {
    return null;
  }
  const main = titles.find((t) => isRecord(t) && (t['@_type'] === 'main' || t['@_level'] === 'a'));
  const chosen = normalizeInline(textOf(main ?? titles[0]));
  return chosen.length > 0 ? chosen : null;
}

function authorsFrom(node: XmlNode): string[] {
  const authors: string[] = [];
  for (const author of asArray(findFirst(node, 'author'))) {
    const persName = isRecord(author) ? author['persName'] : undefined;
    if (persName === undefined) {
      continue;
    }
    const surname = normalizeInline(textOf(findFirst(persName, 'surname')));
    const forenames = asArray(findFirst(persName, 'forename'))
      .map((f) => normalizeInline(textOf(f)))
      .filter((f) => f.length > 0)
      .map((f) => `${f.charAt(0)}.`)
      .join(' ');
    const label = [surname, forenames].filter((part) => part.length > 0).join(', ');
    if (label.length > 0) {
      authors.push(label);
    }
  }
  return authors;
}

function doiFrom(node: XmlNode): string | null {
  for (const idno of asArray(findFirst(node, 'idno'))) {
    if (isRecord(idno) && idno['@_type'] === 'DOI') {
      const value = normalizeInline(textOf(idno));
      if (value.length > 0) {
        return value;
      }
    }
  }
  return null;
}

function yearFrom(node: XmlNode): number | null {
  for (const date of asArray(findFirst(node, 'date'))) {
    if (isRecord(date) && typeof date['@_when'] === 'string') {
      const match = /\d{4}/.exec(date['@_when']);
      if (match !== null) {
        return Number.parseInt(match[0], 10);
      }
    }
  }
  return null;
}

function venueFrom(monogr: XmlNode, analyticTitle: string | null): string | null {
  const monogrTitle = pickMainTitle(findFirst(monogr, 'title'));
  if (analyticTitle !== null && monogrTitle !== null && monogrTitle !== analyticTitle) {
    return monogrTitle;
  }
  const publisher = normalizeInline(textOf(findFirst(findFirst(monogr, 'imprint'), 'publisher')));
  return publisher.length > 0 ? publisher : null;
}

function referencesFrom(root: XmlNode): ManuscriptReference[] {
  const listBibl = findFirst(root, 'listBibl');
  const entries = asArray(findFirst(listBibl, 'biblStruct'));
  const references: ManuscriptReference[] = [];
  entries.forEach((entry, index) => {
    const analytic = isRecord(entry) ? entry['analytic'] : undefined;
    const monogr = isRecord(entry) ? entry['monogr'] : undefined;
    const analyticTitle = pickMainTitle(findFirst(analytic, 'title'));
    const title = analyticTitle ?? pickMainTitle(findFirst(monogr, 'title'));
    const venue = venueFrom(monogr, analyticTitle);
    const doi = doiFrom(entry);
    const year = yearFrom(entry);
    const authors = authorsFrom(entry);
    const rawParts = [
      authors.join('; '),
      year !== null ? `(${year})` : '',
      title ?? '',
    ].filter((part) => part.length > 0);
    const raw = rawParts.length > 0 ? rawParts.join(' ') : `Reference ${index + 1}`;
    references.push({ index, raw, title: title ?? null, doi, year, venue, authors });
  });
  return references;
}

function collectSections(div: XmlNode, out: RawSection[]): void {
  if (!isRecord(div)) {
    return;
  }
  const heading = div['head'] !== undefined ? normalizeInline(textOf(div['head'])) : '';
  const paragraphs = asArray(div['p'])
    .map((p) => normalizeInline(textOf(p)))
    .filter((p) => p.length > 0);
  const text = paragraphs.join('\n');
  if (heading.length > 0 || text.length > 0) {
    out.push({ heading: heading.length > 0 ? heading : null, text });
  }
  for (const child of asArray(div['div'])) {
    collectSections(child, out);
  }
}

export function parseTei(teiXml: string): SectionMap {
  const root = parser.parse(teiXml) as XmlNode;

  const titleStmt = findFirst(findFirst(root, 'teiHeader'), 'titleStmt');
  const title = pickMainTitle(findFirst(titleStmt, 'title'));

  const abstractNode = findFirst(findFirst(root, 'teiHeader'), 'abstract');
  const abstractText = normalizeInline(textOf(abstractNode));
  const abstract = abstractText.length > 0 ? abstractText : null;

  const body = findFirst(findFirst(root, 'text'), 'body');
  const sections: RawSection[] = [];
  for (const div of asArray(isRecord(body) ? body['div'] : undefined)) {
    collectSections(div, sections);
  }

  const references = referencesFrom(findFirst(root, 'text') ?? root);

  return assembleSectionMap({
    title,
    abstract,
    sections,
    references,
    parser: 'grobid',
    parseQuality: 'good',
  });
}
