import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { assembleSectionMap } from '../assemble';
import { docxSectionMap } from '../docx';
import { ingestManuscript } from '../index';
import { sectionMapFromPlainText } from '../plaintext';
import { parseTei } from '../tei';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const teiXml = readFileSync(resolve(fixturesDir, 'sample.tei.xml'), 'utf8');
const docxBytes = readFileSync(resolve(fixturesDir, 'sample.docx'));

describe('parseTei', () => {
  it('maps a GROBID TEI document to title, abstract, sections, and references', () => {
    const map = parseTei(teiXml);

    expect(map.parser).toBe('grobid');
    expect(map.parseQuality).toBe('good');
    expect(map.title).toMatch(/Computational positive psychology/);
    expect((map.abstract ?? '').length).toBeGreaterThan(100);
    expect(map.sections.length).toBeGreaterThanOrEqual(3);
    expect(map.references.length).toBeGreaterThanOrEqual(10);

    const withDoi = map.references.filter((reference) => reference.doi !== null);
    expect(withDoi.length).toBeGreaterThanOrEqual(10);
    expect(map.references[0]?.authors.length).toBeGreaterThan(0);
    expect(map.references[0]?.year).not.toBeNull();
  });

  it('assigns monotonic, non-overlapping line anchors that index fullText', () => {
    const map = parseTei(teiXml);
    const totalLines = map.fullText.split('\n').length;

    let previousEnd = 0;
    for (const section of map.sections) {
      expect(section.lineStart).toBeGreaterThan(previousEnd);
      expect(section.lineEnd).toBeGreaterThanOrEqual(section.lineStart);
      expect(section.lineEnd).toBeLessThanOrEqual(totalLines);
      previousEnd = section.lineEnd;
    }
  });
});

describe('docxSectionMap', () => {
  it('maps a DOCX document to the shared section-map shape', async () => {
    const map = await docxSectionMap(docxBytes);

    expect(map.parser).toBe('mammoth');
    expect(map.parseQuality).toBe('good');
    expect(map.title).toMatch(/Digital Wellbeing/);
    expect(map.abstract).toMatch(/mobile wellbeing intervention/);
    expect(map.sections.map((section) => section.heading)).toContain('Methods');
  });
});

describe('sectionMapFromPlainText', () => {
  it('splits headed plain text into sections and captures the abstract and references', () => {
    const text = [
      'A Study of Flourishing',
      '',
      'Abstract',
      'We report a controlled evaluation of a wellbeing programme.',
      '',
      'Introduction',
      'Prior work established the value of positive interventions.',
      '',
      'Methods',
      'Participants completed weekly measures.',
      '',
      'References',
      'Smith, J. (2019). A study. Journal of Wellbeing. https://doi.org/10.1000/abc123',
      'Jones, K. (2020). Another study. Wellbeing Review.',
    ].join('\n');

    const map = sectionMapFromPlainText(text, 'unpdf', 'degraded');

    expect(map.title).toBe('A Study of Flourishing');
    expect(map.abstract).toMatch(/controlled evaluation/);
    expect(map.sections.map((section) => section.heading)).toEqual(['Introduction', 'Methods']);
    expect(map.references.length).toBeGreaterThanOrEqual(2);
    expect(map.references.some((reference) => reference.doi === '10.1000/abc123')).toBe(true);
  });
});

describe('assembleSectionMap', () => {
  it('places sections after the title and abstract blocks in fullText', () => {
    const map = assembleSectionMap({
      title: 'T',
      abstract: 'A',
      sections: [
        { heading: 'One', text: 'first body' },
        { heading: 'Two', text: 'second body' },
      ],
      references: [],
      parser: 'grobid',
      parseQuality: 'good',
    });

    const lines = map.fullText.split('\n');
    expect(lines[map.sections[0]!.lineStart - 1]).toBe('One');
    expect(lines[map.sections[1]!.lineStart - 1]).toBe('Two');
    expect(map.sections[0]!.lineStart).toBeGreaterThan(1);
  });
});

describe('ingestManuscript', () => {
  it('uses GROBID and records a good parse when the extractor succeeds', async () => {
    const persistTei = vi.fn((tei: string) => `data/blobs/rev/structure.tei.xml:${tei.length}`);
    const result = await ingestManuscript(
      { bytes: new TextEncoder().encode('%PDF-1.4 fake'), kind: 'pdf' },
      { grobidExtract: async () => teiXml, persistTei },
    );

    expect(result.decision).toEqual({ parser: 'grobid', parseQuality: 'good', fallbackReason: null });
    expect(result.sectionMap.parseQuality).toBe('good');
    expect(result.teiPath).not.toBeNull();
    expect(persistTei).toHaveBeenCalledOnce();
  });

  it('falls back to unpdf with a degraded flag and recorded reason when GROBID errors', async () => {
    const decisions: string[] = [];
    const result = await ingestManuscript(
      { bytes: new TextEncoder().encode('%PDF-1.4 fake'), kind: 'pdf' },
      {
        grobidExtract: async () => {
          throw new Error('GROBID returned HTTP 503');
        },
        pdfTextExtract: async () =>
          ['Fallback Title', '', 'Introduction', 'Body text extracted without structure.'].join('\n'),
        onDecision: (decision) => decisions.push(decision.parser),
      },
    );

    expect(result.decision.parser).toBe('unpdf');
    expect(result.decision.parseQuality).toBe('degraded');
    expect(result.decision.fallbackReason).toBe('GROBID returned HTTP 503');
    expect(result.sectionMap.parseQuality).toBe('degraded');
    expect(result.teiPath).toBeNull();
    expect(decisions).toEqual(['unpdf']);
  });

  it('falls back to unpdf when no GROBID extractor is configured', async () => {
    const result = await ingestManuscript(
      { bytes: new TextEncoder().encode('%PDF-1.4 fake'), kind: 'pdf' },
      { pdfTextExtract: async () => ['Title', '', 'Body without grobid.'].join('\n') },
    );

    expect(result.decision.parser).toBe('unpdf');
    expect(result.decision.fallbackReason).toMatch(/not configured/);
  });
});
