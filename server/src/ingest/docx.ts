import mammoth from 'mammoth';
import type { SectionMap } from '@mara/shared';
import { assembleSectionMap, type RawSection } from './assemble';
import { normalizeInline } from './text';

interface HtmlBlock {
  heading: boolean;
  text: string;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function toBlocks(html: string): HtmlBlock[] {
  const blockPattern = /<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const blocks: HtmlBlock[] = [];
  let match: RegExpExecArray | null = blockPattern.exec(html);
  while (match !== null) {
    const tag = (match[1] ?? '').toLowerCase();
    const inner = normalizeInline(decodeEntities((match[2] ?? '').replace(/<[^>]+>/g, ' ')));
    if (inner.length > 0) {
      blocks.push({ heading: tag.startsWith('h'), text: inner });
    }
    match = blockPattern.exec(html);
  }
  return blocks;
}

export async function docxSectionMap(docx: Uint8Array): Promise<SectionMap> {
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(docx) });
  const blocks = toBlocks(html);

  let title: string | null = null;
  let abstract: string | null = null;
  const sections: RawSection[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    const text = buffer.join('\n').trim();
    if (heading !== null && /^abstract\b/i.test(heading)) {
      if (text.length > 0) {
        abstract = text;
      }
    } else if (heading !== null || text.length > 0) {
      sections.push({ heading, text });
    }
    buffer = [];
  };

  for (const block of blocks) {
    if (title === null) {
      title = block.text;
      continue;
    }
    if (block.heading) {
      flush();
      heading = block.text;
    } else {
      buffer.push(block.text);
    }
  }
  flush();

  return assembleSectionMap({ title, abstract, sections, references: [], parser: 'mammoth', parseQuality: 'good' });
}
