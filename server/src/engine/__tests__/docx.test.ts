import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { renderDeliverableDocx } from '../docx';

const body = `# 1. Brief overview
The manuscript reports REV-STAT-0001 with a mean of 8.40 and a **bold caveat** inline.

## 2. Overall recommendation
Major revision at confidence 0.82.

| Criterion | Score | Justification |
| --- | --- | --- |
| 1 | 3 | Grounded in REV-MAP-0001 |
| 2 | 2 | See REV-STAT-0001 |

- First bullet point
- Second bullet with 42% value

1. Provide full Results
2. Rebuild the mediation claims
3. Correct the reference list

Closing paragraph.

1. A second list restarts numbering
2. And continues on its own
`;

async function render(confidential: boolean) {
  return renderDeliverableDocx({
    title: confidential ? "Reviewer's private notes" : 'Peer review report',
    kicker: confidential ? 'Editor-only' : 'Peer review',
    subtitle: 'Major revision at confidence 0.82.',
    metadata: [
      { label: 'Review', value: 'slice-d-test', mono: true },
      { label: 'Recommendation', value: 'Major revision', mono: false },
    ],
    bodyMarkdown: body,
    confidential,
  });
}

async function renderAndUnzip(confidential: boolean) {
  const zip = await JSZip.loadAsync(await render(confidential));
  return zip;
}

describe('branded docx deliverable', () => {
  it('produces a valid docx zip with word/document.xml', async () => {
    const zip = await renderAndUnzip(false);
    expect(Object.keys(zip.files)).toContain('word/document.xml');
  });

  it('embeds no font files and sets no embed flag', async () => {
    const zip = await renderAndUnzip(false);
    const fontParts = Object.keys(zip.files).filter((name) => name.startsWith('word/fonts/'));
    expect(fontParts).toEqual([]);
    const settings = await zip.file('word/settings.xml')?.async('string');
    if (settings !== undefined) {
      expect(settings).not.toContain('embedTrueTypeFonts');
    }
  });

  it('stays small without embedded fonts', async () => {
    const buffer = await render(false);
    expect(buffer.length).toBeLessThan(60_000);
  });

  it('defines the Normal style every built-in style chains to', async () => {
    const zip = await renderAndUnzip(false);
    const styles = await zip.file('word/styles.xml')!.async('string');
    expect(styles).toContain('w:styleId="Normal"');
  });

  it('renders ordered lists as real numbering, restarting per block', async () => {
    const zip = await renderAndUnzip(false);
    const doc = await zip.file('word/document.xml')!.async('string');
    expect(doc).toContain('<w:numPr>');
    expect(doc).not.toContain('1. Provide full Results');
    expect(doc).toContain('Provide full Results');
    const numbering = await zip.file('word/numbering.xml')!.async('string');
    expect(numbering).toContain('lowerLetter');
    const numIds = new Set([...doc.matchAll(/w:numId w:val="(\d+)"/g)].map((match) => match[1]));
    expect(numIds.size).toBeGreaterThanOrEqual(3);
  });

  it('styles document.xml with the brand fonts and palette values', async () => {
    const zip = await renderAndUnzip(false);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Inter');
    expect(xml).toContain('JetBrains Mono');
    expect(xml).toContain('008DA1');
    expect(xml).toContain('006D7C');
    expect(xml).toContain('A7D12B');
    expect(xml).toContain('FEFCF5');
    expect(xml).toContain('REV-STAT-0001');
  });

  it('renders bold inline text as bold runs, not literal asterisks', async () => {
    const zip = await renderAndUnzip(false);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).not.toContain('**bold caveat**');
    expect(xml).toContain('bold caveat');
  });

  it('does not fragment runs around plain numbers', async () => {
    const zip = await renderAndUnzip(false);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('with a mean of 8.40 and a ');
  });

  it('keeps the reviewer identity anonymous in the document properties', async () => {
    const zip = await renderAndUnzip(false);
    const core = await zip.file('docProps/core.xml')!.async('string');
    expect(core).toContain('The Reviewer');
    expect(core).not.toContain('Llewellyn');
    expect(core).not.toContain('Claude');
  });

  it('marks the private notes footer confidential and counts total pages', async () => {
    const zip = await renderAndUnzip(true);
    const footerNames = Object.keys(zip.files).filter((name) => name.startsWith('word/footer'));
    expect(footerNames.length).toBeGreaterThan(0);
    const footer = await zip.file(footerNames[0]!)!.async('string');
    expect(footer).toContain('Confidential');
    expect(footer).toContain('NUMPAGES');
  });
});
