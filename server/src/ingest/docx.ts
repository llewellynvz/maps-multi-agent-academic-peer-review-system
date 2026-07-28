import mammoth from 'mammoth';
import type { ParseQuality, SectionMap } from '@mara/shared';
import { assembleSectionMap, type RawSection } from './assemble';
import { splitReferences } from './plaintext';
import { looksLikeStrongHeading, normalizeInline } from './text';

const REFERENCES_HEADING = /^(references|bibliography|works cited)\b/i;
// A numbered Vancouver reference line satisfies looksLikeStrongHeading, so leaving references mode on
// any heading-shaped block re-reads the reference list as body. Only a named trailing section ends it.
// These are stems followed by \w* rather than \b: a trailing \b after a stem can never match its own
// inflection, because the next character is a word character ("acknowledg" against "Acknowledgements").
const POST_REFERENCES_HEADING =
  /^(appendix|appendices|supplement|acknowledg|author biograph|author contribution|funding|conflict|competing interest|declaration|ethic|data availability|footnote|endnote|note|table|figure)\w*/i;

interface HtmlBlock {
  heading: boolean;
  text: string;
}

function isBoldOnly(rawInner: string, text: string): boolean {
  if (text.length === 0 || text.length > 120 || /[.!?]$/.test(text)) {
    return false;
  }
  const boldSpans = rawInner.match(/<(strong|b)\b[^>]*>[\s\S]*?<\/\1>/gi);
  if (boldSpans === null) {
    return false;
  }
  const bold = normalizeInline(decodeEntities(boldSpans.map((span) => span.replace(/<[^>]+>/g, ' ')).join(' ')));
  return bold === text;
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
    const rawInner = match[2] ?? '';
    const inner = normalizeInline(decodeEntities(rawInner.replace(/<[^>]+>/g, ' ')));
    if (inner.length > 0) {
      const heading = tag.startsWith('h') || isBoldOnly(rawInner, inner) || looksLikeStrongHeading(inner);
      blocks.push({ heading, text: inner });
    }
    match = blockPattern.exec(html);
  }
  return blocks;
}

// A manuscript is prose. Anything past this is a corpus, an embedded media dump, or a decompression
// bomb, and mammoth would hold the whole conversion in memory before anything could reject it.
const MAX_DOCX_BYTES = 64 * 1024 * 1024;

export async function docxSectionMap(docx: Uint8Array): Promise<SectionMap> {
  if (docx.byteLength > MAX_DOCX_BYTES) {
    throw new Error(`DOCX manuscript is ${docx.byteLength} bytes, over the ${MAX_DOCX_BYTES} byte limit`);
  }
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(docx) });
  const blocks = toBlocks(html);

  let title: string | null = null;
  let abstract: string | null = null;
  const sections: RawSection[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];
  let inReferences = false;
  const referenceLines: string[] = [];

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
      if (inReferences && !POST_REFERENCES_HEADING.test(block.text)) {
        referenceLines.push(block.text);
      } else {
        if (!inReferences) {
          flush();
        }
        inReferences = REFERENCES_HEADING.test(block.text);
        if (!inReferences) {
          heading = block.text;
        }
      }
    } else if (inReferences) {
      referenceLines.push(block.text);
    } else {
      buffer.push(block.text);
    }
  }
  if (!inReferences) {
    flush();
  }

  const references = referenceLines.length > 0 ? splitReferences(referenceLines.join('\n')) : [];
  const structured = abstract !== null || sections.some((section) => section.heading !== null) || sections.length > 1;
  const parseQuality: ParseQuality = structured ? 'good' : 'degraded';
  return assembleSectionMap({ title, abstract, sections, references, parser: 'mammoth', parseQuality });
}
