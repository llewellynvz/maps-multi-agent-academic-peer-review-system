import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  type IParagraphOptions,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { repoRoot } from '../paths';

const INTER = 'Inter';
const MONO = 'JetBrains Mono';

const TEAL = '008DA1';
const TEAL_DARK = '006D7C';
const GRAPHITE = '2B2D2E';
const GREY = '595959';
const BONE = 'FEFCF5';
const TEAL_TINT = 'E8F5F7';
const LIME = 'A7D12B';
const TABLE_BORDER = 'CFE6EA';

const FONT_DIR = resolve(repoRoot, 'server', 'assets', 'fonts');

interface EmbeddedFont {
  name: string;
  data: Buffer;
}

let embeddedFontsCache: EmbeddedFont[] | null = null;

function loadEmbeddedFonts(): EmbeddedFont[] {
  if (embeddedFontsCache !== null) {
    return embeddedFontsCache;
  }
  const candidates: Array<{ name: string; file: string }> = [
    { name: INTER, file: 'Inter_18pt-Regular.ttf' },
    { name: MONO, file: 'JetBrainsMono-Regular.ttf' },
  ];
  const loaded: EmbeddedFont[] = [];
  for (const candidate of candidates) {
    const path = resolve(FONT_DIR, candidate.file);
    if (existsSync(path)) {
      loaded.push({ name: candidate.name, data: readFileSync(path) });
    }
  }
  embeddedFontsCache = loaded;
  return loaded;
}

const PAGE = {
  width: 11906,
  height: 16838,
  margin: { top: 2350, bottom: 1650, left: 1134, right: 1134 },
};

const MONO_TOKEN = /(REV-[A-Z]{3,4}-\d{4}|\b\d[\d.,%]*\b)/g;

export interface DeliverableMetadataRow {
  label: string;
  value: string;
  mono: boolean;
}

export interface DeliverableJob {
  title: string;
  kicker: string;
  subtitle: string;
  metadata: DeliverableMetadataRow[];
  bodyMarkdown: string;
  confidential: boolean;
}

function letterheadBand(): Header {
  return new Header({
    children: [
      new Paragraph({
        spacing: { after: 40 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: LIME } },
        children: [
          new TextRun({ text: 'PSYNALYTICS', bold: true, color: TEAL_DARK, font: INTER, size: 18 }),
          new TextRun({ text: '   Peer review', color: GREY, font: INTER, size: 16 }),
        ],
      }),
    ],
  });
}

function inlineRuns(text: string, color: string, font: string): TextRun[] {
  const runs: TextRun[] = [];
  const parts = text.split(MONO_TOKEN);
  for (const part of parts) {
    if (part.length === 0) {
      continue;
    }
    const isMono = /^REV-[A-Z]{3,4}-\d{4}$/.test(part) || /^\d[\d.,%]*$/.test(part);
    runs.push(new TextRun({ text: part, color, font: isMono ? MONO : font }));
  }
  return runs.length > 0 ? runs : [new TextRun({ text, color, font })];
}

function banner(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 260, after: 160 },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: TEAL_DARK },
    children: [new TextRun({ text, bold: true, color: BONE, font: INTER, size: 26 })],
  });
}

function subHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text, bold: true, color: TEAL_DARK, font: INTER, size: 24 })],
  });
}

function minorHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 160, after: 80 },
    children: [new TextRun({ text, bold: true, color: TEAL_DARK, font: INTER, size: 22 })],
  });
}

function bodyParagraph(text: string, options: Partial<IParagraphOptions> = {}): Paragraph {
  return new Paragraph({
    spacing: { after: 120, line: 300 },
    children: inlineRuns(text, GRAPHITE, INTER),
    ...options,
  });
}

function cellShade(fill: string): { type: (typeof ShadingType)['CLEAR']; color: string; fill: string } {
  return { type: ShadingType.CLEAR, color: 'auto', fill };
}

function tableFrom(rows: string[][]): Table {
  const [header, ...body] = rows;
  const border = { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER };
  const borders = { top: border, bottom: border, left: border, right: border };
  const headerRow = new TableRow({
    tableHeader: true,
    children: (header ?? []).map(
      (value) =>
        new TableCell({
          shading: cellShade(TEAL),
          borders,
          children: [new Paragraph({ children: [new TextRun({ text: value, bold: true, color: BONE, font: INTER })] })],
        }),
    ),
  });
  const bodyRows = body.map((cells, rowIndex) => {
    const fill = rowIndex % 2 === 0 ? TEAL_TINT : BONE;
    return new TableRow({
      children: cells.map((value, cellIndex) => {
        const isFirst = cellIndex === 0;
        return new TableCell({
          shading: cellShade(fill),
          borders,
          children: [
            new Paragraph({
              children: isFirst
                ? [new TextRun({ text: value, bold: true, color: TEAL_DARK, font: INTER })]
                : inlineRuns(value, GRAPHITE, INTER),
            }),
          ],
        });
      }),
    });
  });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] });
}

function parseBody(markdown: string): Array<Paragraph | Table> {
  const lines = markdown.split(/\r?\n/);
  const blocks: Array<Paragraph | Table> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      i += 1;
      continue;
    }
    if (trimmed.startsWith('|') && (lines[i + 1] ?? '').includes('---')) {
      const tableLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        tableLines.push(lines[i] ?? '');
        i += 1;
      }
      const rows = tableLines
        .filter((row) => !/^\s*\|?[\s|:-]+\|?\s*$/.test(row) || !row.includes('---'))
        .map((row) =>
          row
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((cell) => cell.trim()),
        );
      if (rows.length > 0) {
        blocks.push(tableFrom(rows));
      }
      continue;
    }
    if (trimmed.startsWith('### ')) {
      blocks.push(minorHeading(trimmed.slice(4)));
    } else if (trimmed.startsWith('## ')) {
      blocks.push(subHeading(trimmed.slice(3)));
    } else if (trimmed.startsWith('# ')) {
      blocks.push(banner(trimmed.slice(2)));
    } else if (/^[-*]\s+/.test(trimmed)) {
      blocks.push(bodyParagraph(cleanInline(trimmed.replace(/^[-*]\s+/, '')), { bullet: { level: 0 } }));
    } else if (/^\d+\.\s+/.test(trimmed)) {
      blocks.push(bodyParagraph(cleanInline(trimmed)));
    } else {
      blocks.push(bodyParagraph(cleanInline(trimmed)));
    }
    i += 1;
  }
  return blocks;
}

function cleanInline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}

function titleBlock(job: DeliverableJob): Array<Paragraph | Table> {
  const blocks: Array<Paragraph | Table> = [];
  blocks.push(
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: job.kicker.toUpperCase(), color: TEAL, font: INTER, bold: true, size: 18 })],
    }),
  );
  blocks.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: job.title, color: TEAL_DARK, font: INTER, bold: true, size: 44 })],
    }),
  );
  blocks.push(
    new Paragraph({
      spacing: { after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: LIME } },
      children: [new TextRun({ text: job.subtitle, color: GREY, font: INTER, size: 20 })],
    }),
  );
  if (job.metadata.length > 0) {
    const rows = job.metadata.map(
      (row) =>
        new TableRow({
          children: [
            new TableCell({
              shading: cellShade(TEAL_TINT),
              borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
                left: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
                right: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
              },
              width: { size: 30, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun({ text: row.label, bold: true, color: TEAL_DARK, font: INTER })] })],
            }),
            new TableCell({
              shading: cellShade(BONE),
              borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
                left: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
                right: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
              },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: row.value, color: GRAPHITE, font: row.mono ? MONO : INTER })],
                }),
              ],
            }),
          ],
        }),
    );
    blocks.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
    blocks.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  }
  return blocks;
}

export async function renderDeliverableDocx(job: DeliverableJob): Promise<Buffer> {
  const footerText = job.confidential ? 'Confidential. Page ' : 'Page ';
  const fonts = loadEmbeddedFonts();
  const document = new Document({
    creator: 'The Reviewer',
    title: job.title,
    description: '',
    ...(fonts.length > 0 ? { fonts } : {}),
    styles: {
      default: {
        document: { run: { font: INTER, size: 20, color: GRAPHITE } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.width, height: PAGE.height },
            margin: PAGE.margin,
          },
        },
        headers: {
          default: letterheadBand(),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: footerText, color: GREY, font: INTER, size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], color: GREY, font: MONO, size: 16 }),
                ],
              }),
            ],
          }),
        },
        children: [...titleBlock(job), ...parseBody(job.bodyMarkdown)],
      },
    ],
  });
  return Packer.toBuffer(document);
}
