import { describe, expect, it, vi } from 'vitest';

vi.mock('mammoth', () => ({
  default: {
    convertToHtml: vi.fn(async () => ({
      value:
        '<h1>Title</h1><h2>Introduction</h2><p>Body &amp;lt;x&amp;gt; text.</p>' +
        '<ul><li>Point one<ul><li>Sub point</li></ul></li><li><p>Point two</p></li></ul>' +
        '<h2>References</h2><ol><li>Smith J. A study of things. J Psych. 2020;1:1-2.</li>' +
        '<li>Doe A. Another study of things. Psych Rev. 2021;2:3-4.</li></ol>',
    })),
  },
}));

const { docxSectionMap } = await import('../docx');

describe('docxSectionMap list handling', () => {
  it('keeps Word list items, including a numbered reference list', async () => {
    const map = await docxSectionMap(new Uint8Array(8));
    const body = map.sections.map((section) => section.text).join('\n');
    expect(body).toContain('Point one');
    expect(body).toContain('Sub point');
    expect(body).toContain('Point two');
    expect(map.references).toHaveLength(2);
  });

  it('decodes an escaped entity once', async () => {
    const map = await docxSectionMap(new Uint8Array(8));
    expect(map.sections.map((section) => section.text).join('\n')).toContain('Body &lt;x&gt; text.');
  });
});

describe('splitReferences DOI extraction', () => {
  it('drops a closing bracket the DOI did not open but keeps balanced ones', async () => {
    const { splitReferences } = await import('../plaintext');
    const [wrapped, balanced] = splitReferences(
      'Smith J. A study of things (doi:10.1000/abc).\nLancet authors. Paper title. 10.1016/S0140-6736(20)30183-5.',
    );
    expect(wrapped?.doi).toBe('10.1000/abc');
    expect(balanced?.doi).toBe('10.1016/S0140-6736(20)30183-5');
  });
});
