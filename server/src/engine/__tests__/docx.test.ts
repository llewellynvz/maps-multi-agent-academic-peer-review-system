import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { renderDeliverableDocx } from '../docx';

const body = `# 1. Brief overview
The manuscript reports REV-STAT-0001 with a mean of 8.40, a **bold caveat**, and an *italic aside* inline.

## 2. Overall recommendation
Major revision at confidence 0.82.

### A subsection heading

#### A minor heading

| Criterion | Score | Justification |
| --- | --- | --- |
| 1 | 3 | Grounded in REV-MAP-0001 |
| 2 | 2 | See REV-STAT-0001 |

- First bullet point
- Second bullet with 42% value
  - A nested bullet

1. Provide full Results

2. Rebuild the mediation claims

3. Correct the reference list

Closing paragraph between two lists.

1. A second list restarts numbering

2. And continues on its own

Prose between the lists forces the next one to be a fresh list.

11. Eleventh criterion opens above one

12. Twelfth criterion follows it
`;

async function render(confidential: boolean, markdown: string = body) {
  return renderDeliverableDocx({
    title: confidential ? "Reviewer's private notes" : 'Peer review report',
    kicker: confidential ? 'Editor-only' : 'Peer review',
    subtitle: 'Major revision, held with reasonable confidence.',
    metadata: [
      { label: 'Review', value: 'slice-d-test', mono: true },
      { label: 'Recommendation', value: 'Major revision', mono: false },
    ],
    bodyMarkdown: markdown,
    confidential,
  });
}

async function parts(confidential = false, markdown: string = body) {
  const zip = await JSZip.loadAsync(await render(confidential, markdown));
  return {
    zip,
    doc: await zip.file('word/document.xml')!.async('string'),
    numbering: (await zip.file('word/numbering.xml')?.async('string')) ?? '',
    styles: await zip.file('word/styles.xml')!.async('string'),
  };
}

function numToAbstract(numbering: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of numbering.matchAll(/<w:num w:numId="(\d+)"[^>]*>\s*<w:abstractNumId w:val="(\d+)"/g)) {
    map[m[1]!] = m[2]!;
  }
  return map;
}

function abstractLevelZero(numbering: string): Record<string, { lvlText: string; font?: string; numFmt?: string; start?: string }> {
  const info: Record<string, { lvlText: string; font?: string; numFmt?: string; start?: string }> = {};
  for (const m of numbering.matchAll(/<w:abstractNum w:abstractNumId="(\d+)"[\s\S]*?(?=<w:abstractNum |<\/w:numbering>)/g)) {
    const block = m[0];
    info[m[1]!] = {
      lvlText: (block.match(/<w:lvlText w:val="([^"]*)"/) ?? [])[1] ?? '',
      font: (block.match(/w:ascii="([^"]*)"/) ?? [])[1],
      numFmt: (block.match(/<w:numFmt w:val="([^"]*)"/) ?? [])[1],
      start: (block.match(/<w:start w:val="(\d+)"/) ?? [])[1],
    };
  }
  return info;
}

describe('branded docx deliverable', () => {
  it('produces a valid docx zip with word/document.xml', async () => {
    const { zip } = await parts();
    expect(Object.keys(zip.files)).toContain('word/document.xml');
  });

  it('embeds no font files and sets no embed flag', async () => {
    const { zip } = await parts();
    expect(Object.keys(zip.files).filter((name) => name.startsWith('word/fonts/'))).toEqual([]);
    const settings = await zip.file('word/settings.xml')?.async('string');
    if (settings !== undefined) {
      expect(settings).not.toContain('embedTrueTypeFonts');
    }
  });

  it('stays within the size budget without embedded fonts', async () => {
    const buffer = await render(false);
    expect(buffer.length).toBeGreaterThan(8_000);
    expect(buffer.length).toBeLessThan(120_000);
  });

  it('renders each ordered list at the ordinal the source specifies, not a forced 1', async () => {
    const { numbering } = await parts();
    const starts = new Set([...numbering.matchAll(/<w:start w:val="(\d+)"/g)].map((m) => m[1]));
    expect(starts.has('1')).toBe(true);
    expect(starts.has('11')).toBe(true);
  });

  it('allocates one abstract numbering per distinct start value', async () => {
    const { numbering } = await parts();
    const info = abstractLevelZero(numbering);
    const decimalStarts = Object.values(info)
      .filter((entry) => entry.numFmt === 'decimal')
      .map((entry) => entry.start)
      .filter((value): value is string => value !== undefined);
    expect(new Set(decimalStarts)).toEqual(new Set(['1', '11']));
  });

  it('restarts a fresh ordered list, giving each list block its own concrete numbering', async () => {
    const { doc, numbering } = await parts();
    const map = numToAbstract(numbering);
    const info = abstractLevelZero(numbering);
    const usedNumIds = [...new Set([...doc.matchAll(/<w:numId w:val="(\d+)"/g)].map((m) => m[1]!))];
    const startOneNumIds = usedNumIds.filter((id) => info[map[id] ?? '']?.numFmt === 'decimal' && info[map[id] ?? '']?.start === '1');
    expect(startOneNumIds.length).toBeGreaterThanOrEqual(2);
  });

  it('renders small Symbol bullets rather than the oversized black circle', async () => {
    const { doc, numbering } = await parts();
    const map = numToAbstract(numbering);
    const info = abstractLevelZero(numbering);
    const usedNumIds = [...new Set([...doc.matchAll(/<w:numId w:val="(\d+)"/g)].map((m) => m[1]!))];
    const usedBullets = usedNumIds
      .map((id) => info[map[id] ?? ''])
      .filter((entry) => entry?.numFmt === 'bullet');
    expect(usedBullets.length).toBeGreaterThan(0);
    for (const bullet of usedBullets) {
      expect(bullet?.lvlText).toBe('\u{F0B7}');
      expect(bullet?.font).toBe('Symbol');
      expect(bullet?.lvlText).not.toBe('\u{25CF}');
    }
  });

  it('gives headings strictly descending sizes, all larger than the body', async () => {
    const { doc } = await parts();
    const sizes = [...doc.matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => Number(m[1]));
    const bodySize = 22;
    const headingSizes = [36, 30, 26, 24];
    for (const size of headingSizes) {
      expect(sizes).toContain(size);
      expect(size).toBeGreaterThan(bodySize);
    }
    for (let i = 1; i < headingSizes.length; i += 1) {
      expect(headingSizes[i]!).toBeLessThan(headingSizes[i - 1]!);
    }
  });

  it('handles a level-four heading rather than printing literal hashes', async () => {
    const { doc } = await parts();
    expect(doc).not.toContain('#### A minor heading');
    expect(doc.toUpperCase()).toContain('A MINOR HEADING');
  });

  it('sets body spacing once on the Normal style', async () => {
    const { styles } = await parts();
    expect(styles).toContain('w:styleId="Normal"');
    const normalBlock = styles.match(/<w:style [^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/)?.[0] ?? '';
    expect(normalBlock).toMatch(/<w:spacing[^>]*w:line="360"/);
  });

  it('starts with a cover page and exactly one page break', async () => {
    const { doc } = await parts();
    expect(doc).toContain('<w:titlePg/>');
    expect((doc.match(/<w:br w:type="page"\/>/g) ?? []).length).toBe(1);
  });

  it('renders ordered lists as numbering, dropping the literal ordinal from prose', async () => {
    const { doc } = await parts();
    expect(doc).toContain('<w:numPr>');
    expect(doc).not.toContain('1. Provide full Results');
    expect(doc).toContain('Provide full Results');
  });

  it('styles document.xml with the brand fonts and palette values', async () => {
    const { doc } = await parts();
    expect(doc).toContain('Inter');
    expect(doc).toContain('JetBrains Mono');
    expect(doc).toContain('008DA1');
    expect(doc).toContain('006D7C');
    expect(doc).toContain('A7D12B');
    expect(doc).toContain('FEFCF5');
    expect(doc).toContain('REV-STAT-0001');
  });

  it('renders bold and italic inline text as runs, not literal markers', async () => {
    const { doc } = await parts();
    expect(doc).not.toContain('**bold caveat**');
    expect(doc).toContain('bold caveat');
    expect(doc).not.toContain('*italic aside*');
    expect(doc).toContain('italic aside');
  });

  it('does not fragment runs around plain numbers', async () => {
    const { doc } = await parts();
    expect(doc).toContain('with a mean of 8.40, a ');
  });

  it('keeps the reviewer identity anonymous in the document properties', async () => {
    const { zip } = await parts();
    const core = await zip.file('docProps/core.xml')!.async('string');
    expect(core).toContain('The Reviewer');
    expect(core).not.toContain('Llewellyn');
    expect(core).not.toContain('Claude');
  });

  it('marks the private notes footer confidential and counts total pages', async () => {
    const zip = await JSZip.loadAsync(await render(true));
    const footerNames = Object.keys(zip.files).filter((name) => name.startsWith('word/footer'));
    expect(footerNames.length).toBeGreaterThan(0);
    const footerBodies = await Promise.all(footerNames.map((name) => zip.file(name)!.async('string')));
    const confidential = footerBodies.find((text) => text.includes('Confidential'));
    expect(confidential).toBeDefined();
    expect(confidential).toContain('NUMPAGES');
  });
});
