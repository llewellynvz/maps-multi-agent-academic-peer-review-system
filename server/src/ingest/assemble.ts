import type { ManuscriptParser, ManuscriptReference, ManuscriptSection, ParseQuality, SectionMap } from '@mara/shared';

export interface RawSection {
  heading: string | null;
  text: string;
}

export interface AssembleInput {
  title: string | null;
  abstract: string | null;
  sections: RawSection[];
  references: ManuscriptReference[];
  parser: ManuscriptParser;
  parseQuality: ParseQuality;
}

export function assembleSectionMap(input: AssembleInput): SectionMap {
  const lines: string[] = [];

  const pushBlock = (block: string): { start: number; end: number } => {
    if (lines.length > 0) {
      lines.push('');
    }
    const start = lines.length + 1;
    const blockLines = block.length === 0 ? [''] : block.split('\n');
    for (const line of blockLines) {
      lines.push(line);
    }
    return { start, end: lines.length };
  };

  if (input.title !== null && input.title.length > 0) {
    pushBlock(input.title);
  }
  if (input.abstract !== null && input.abstract.length > 0) {
    pushBlock(`Abstract\n${input.abstract}`);
  }

  const sections: ManuscriptSection[] = input.sections.map((raw, index) => {
    const block = raw.heading !== null && raw.heading.length > 0 ? `${raw.heading}\n${raw.text}` : raw.text;
    const anchor = pushBlock(block);
    return { index, heading: raw.heading, text: raw.text, lineStart: anchor.start, lineEnd: anchor.end };
  });

  return {
    title: input.title,
    abstract: input.abstract,
    sections,
    references: input.references,
    fullText: lines.join('\n'),
    parser: input.parser,
    parseQuality: input.parseQuality,
  };
}
