import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { renderDeliverableDocx } from '../docx';

const body = `# 1. Brief overview
The manuscript reports REV-STAT-0001 with a mean of 8.40.

## 2. Overall recommendation
Major revision at confidence 0.82.

| Criterion | Score | Justification |
| --- | --- | --- |
| 1 | 3 | Grounded in REV-MAP-0001 |
| 2 | 2 | See REV-STAT-0001 |

- First bullet point
- Second bullet with 42% value
`;

async function renderAndUnzip(confidential: boolean) {
  const buffer = await renderDeliverableDocx({
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
  const zip = await JSZip.loadAsync(buffer);
  return zip;
}

describe('branded docx deliverable', () => {
  it('produces a valid docx zip with word/document.xml', async () => {
    const zip = await renderAndUnzip(false);
    expect(Object.keys(zip.files)).toContain('word/document.xml');
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

  it('keeps the reviewer identity anonymous in the document properties', async () => {
    const zip = await renderAndUnzip(false);
    const core = await zip.file('docProps/core.xml')!.async('string');
    expect(core).toContain('The Reviewer');
    expect(core).not.toContain('Llewellyn');
    expect(core).not.toContain('Claude');
  });

  it('marks the private notes footer confidential', async () => {
    const zip = await renderAndUnzip(true);
    const footerNames = Object.keys(zip.files).filter((name) => name.startsWith('word/footer'));
    expect(footerNames.length).toBeGreaterThan(0);
    const footer = await zip.file(footerNames[0]!)!.async('string');
    expect(footer).toContain('Confidential');
  });
});
