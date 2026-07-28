import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, HeadingLevel, Packer, Paragraph } from 'docx';
import { describe, expect, it, vi } from 'vitest';
import { assembleSectionMap } from '../assemble';
import { docxSectionMap } from '../docx';
import { ingestManuscript, ParseHaltError } from '../index';
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
    const withVenue = map.references.filter((reference) => reference.venue !== null);
    expect(withVenue.length).toBeGreaterThanOrEqual(10);
    expect(map.references[0]?.authors.length).toBeGreaterThan(0);
    expect(map.references[0]?.year).not.toBeNull();
  });

  it('keeps inline citations in place instead of hoisting them to the paragraph head', () => {
    const inline = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title level="a" type="main">Agency and wellbeing</title></titleStmt></fileDesc></teiHeader>
  <text><body><div><head>INTRODUCTION</head><p>Positive psychology studies flourishing <ref type="bibr" target="#b31">(Keyes, 2002;</ref><ref type="bibr" target="#b58">Ryff, 1989)</ref>. The field advanced since <ref type="bibr" target="#b61">Seligman (2000)</ref> published that paper.</p></div></body></text>
</TEI>`;
    const map = parseTei(inline);
    const text = map.sections[0]?.text ?? '';

    expect(text).toBe('Positive psychology studies flourishing (Keyes, 2002;Ryff, 1989). The field advanced since Seligman (2000) published that paper.');
    expect(text.startsWith('Positive psychology')).toBe(true);
    expect(text).not.toContain('sincepublished');
  });

  it('marks a header-only TEI degraded rather than reporting it as a good parse', () => {
    const headerOnly = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title level="a" type="main">Scanned paper</title></titleStmt></fileDesc></teiHeader>
  <text><body></body></text>
</TEI>`;
    const map = parseTei(headerOnly);

    expect(map.sections.length).toBe(0);
    expect(map.abstract).toBeNull();
    expect(map.parseQuality).toBe('degraded');
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

  it('extracts the references section instead of dropping it', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'A Trial of Compassion Training', heading: HeadingLevel.TITLE }),
            new Paragraph({ text: 'Introduction', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('Compassion interventions improve wellbeing.'),
            new Paragraph({ text: 'References', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('Neff, K. D. (2003). Self-compassion. Self and Identity, 2(2), 85-101. https://doi.org/10.1080/15298860309032'),
            new Paragraph('Gilbert, P. (2014). The origins of compassion. British Journal of Clinical Psychology, 53(1), 6-41.'),
            new Paragraph({ text: 'Appendix A', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('Supplementary measures are listed here.'),
          ],
        },
      ],
    });
    const bytes = new Uint8Array(await Packer.toBuffer(doc));
    const map = await docxSectionMap(bytes);

    expect(map.references.length).toBe(2);
    expect(map.references[0]?.doi).toBe('10.1080/15298860309032');
    expect(map.references[1]?.year).toBe(2014);
    const headings = map.sections.map((section) => section.heading);
    expect(headings).toContain('Appendix A');
    expect(headings).not.toContain('References');
    expect(map.sections.some((section) => section.text.includes('Neff'))).toBe(false);
  });

  it('keeps numbered Vancouver references in the reference list instead of reading them as sections', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Cardiac Outcomes After Rehabilitation', heading: HeadingLevel.TITLE }),
            new Paragraph({ text: 'Introduction', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('Rehabilitation improves cardiac outcomes.'),
            new Paragraph({ text: 'References', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('1. Smith J, Doe A. Cardiac outcomes. Lancet. 2019;393:1-10'),
            new Paragraph('2. Brown K, Patel R. Rehabilitation trials. BMJ. 2020;368:55-62'),
            new Paragraph('3. Osei L, Tan M. Long term follow up. JAMA. 2021;325:900-910'),
            new Paragraph({ text: 'Appendix A', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('Supplementary measures are listed here.'),
          ],
        },
      ],
    });
    const bytes = new Uint8Array(await Packer.toBuffer(doc));
    const map = await docxSectionMap(bytes);

    expect(map.references.length).toBe(3);
    const headings = map.sections.map((section) => section.heading);
    expect(headings).toContain('Appendix A');
    expect(headings).not.toContain('1. Smith J, Doe A. Cardiac outcomes. Lancet. 2019;393:1-10');
    expect(map.sections.some((section) => section.text.includes('Smith J'))).toBe(false);
  });

  it('ends the reference list at an inflected trailing heading rather than swallowing the section', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Agency Under Automated Systems', heading: HeadingLevel.TITLE }),
            new Paragraph({ text: 'Introduction', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('Automation reshapes how agency is exercised.'),
            new Paragraph({ text: 'References', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('1. Smith J, Doe A. Cardiac outcomes. Lancet. 2019;393:1-10'),
            new Paragraph({ text: 'Acknowledgements', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('We thank the reviewers for their time.'),
            new Paragraph({ text: 'Author biographies', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('The first author is a professor of work psychology.'),
          ],
        },
      ],
    });
    const bytes = new Uint8Array(await Packer.toBuffer(doc));
    const map = await docxSectionMap(bytes);

    expect(map.references.length).toBe(1);
    const headings = map.sections.map((section) => section.heading);
    expect(headings).toContain('Acknowledgements');
    expect(headings).toContain('Author biographies');
    expect(map.references.some((reference) => (reference.raw ?? '').includes('professor'))).toBe(false);
  });

  it('does not split a short capitalised body line into a spurious section', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'A Study of Descriptives', heading: HeadingLevel.TITLE }),
            new Paragraph({ text: 'Introduction', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('Prior work established the value of positive interventions.'),
            new Paragraph('Table 2 Means and SDs'),
            new Paragraph('The table reports descriptive statistics for each measure.'),
          ],
        },
      ],
    });
    const bytes = new Uint8Array(await Packer.toBuffer(doc));
    const map = await docxSectionMap(bytes);

    expect(map.sections.map((section) => section.heading)).not.toContain('Table 2 Means and SDs');
  });

  it('marks a single unheaded blob with no abstract as a degraded parse', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'A Title Line', heading: HeadingLevel.TITLE }),
            new Paragraph('One long run of body text with no headings at all and no abstract present here.'),
          ],
        },
      ],
    });
    const bytes = new Uint8Array(await Packer.toBuffer(doc));
    const map = await docxSectionMap(bytes);

    expect(map.parseQuality).toBe('degraded');
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

  it('hard-halts a PDF when GROBID errors and fallback is not allowed', async () => {
    await expect(
      ingestManuscript(
        { bytes: new TextEncoder().encode('%PDF-1.4 fake'), kind: 'pdf' },
        {
          grobidExtract: async () => {
            throw new Error('GROBID returned HTTP 503');
          },
        },
      ),
    ).rejects.toThrow(ParseHaltError);
  });

  it('names the real cause when it hard-halts a PDF', async () => {
    let caught: unknown;
    try {
      await ingestManuscript(
        { bytes: new TextEncoder().encode('%PDF-1.4 fake'), kind: 'pdf' },
        {
          grobidExtract: async () => {
            throw new Error('GROBID returned HTTP 503');
          },
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParseHaltError);
    expect((caught as ParseHaltError).reason).toBe('GROBID returned HTTP 503');
  });

  it('hard-halts a PDF when no GROBID extractor is configured', async () => {
    await expect(
      ingestManuscript({ bytes: new TextEncoder().encode('%PDF-1.4 fake'), kind: 'pdf' }, {}),
    ).rejects.toThrow(ParseHaltError);
  });

  it('still falls back to unpdf with a degraded flag when fallback is explicitly allowed', async () => {
    const decisions: string[] = [];
    const result = await ingestManuscript(
      { bytes: new TextEncoder().encode('%PDF-1.4 fake'), kind: 'pdf' },
      {
        allowPdfFallback: true,
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

  it('leaves DOCX unaffected by the PDF hard-halt policy', async () => {
    const result = await ingestManuscript({ bytes: docxBytes, kind: 'docx' }, {});
    expect(result.decision.parser).toBe('mammoth');
    expect(result.decision.parseQuality).toBe('good');
  });
});
