import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  type IParagraphOptions,
  LevelFormat,
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

const PAGE = {
  width: 11906,
  height: 16838,
  margin: { top: 2350, bottom: 1650, left: 1134, right: 1134 },
};

const FINDING_ID = /REV-[A-Z]{3,4}-\d{4}/;
const INLINE_TOKEN = /(\*\*.+?\*\*|`[^`]+`|REV-[A-Z]{3,4}-\d{4})/g;

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

function plainText(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}

function inlineRuns(text: string, color: string, font: string): TextRun[] {
  const runs: TextRun[] = [];
  for (const part of text.split(INLINE_TOKEN)) {
    if (part.length === 0) {
      continue;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const inner = part.slice(2, -2);
      for (const piece of inner.split(INLINE_TOKEN)) {
        if (piece.length === 0) {
          continue;
        }
        const mono = FINDING_ID.test(piece) && piece.match(FINDING_ID)?.[0] === piece;
        runs.push(new TextRun({ text: mono ? piece : plainText(piece), bold: true, color, font: mono ? MONO : font }));
      }
      continue;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      runs.push(new TextRun({ text: part.slice(1, -1), color, font: MONO }));
      continue;
    }
    if (FINDING_ID.test(part) && part.match(FINDING_ID)?.[0] === part) {
      runs.push(new TextRun({ text: part, color, font: MONO }));
      continue;
    }
    runs.push(new TextRun({ text: part, color, font }));
  }
  return runs.length > 0 ? runs : [new TextRun({ text: plainText(text), color, font })];
}

function banner(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 260, after: 160 },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: TEAL_DARK },
    children: [new TextRun({ text: plainText(text), bold: true, color: BONE, font: INTER, size: 26 })],
  });
}

function subHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text: plainText(text), bold: true, color: TEAL_DARK, font: INTER, size: 24 })],
  });
}

function minorHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 160, after: 80 },
    children: [new TextRun({ text: plainText(text), bold: true, color: TEAL_DARK, font: INTER, size: 22 })],
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
          children: [new Paragraph({ children: [new TextRun({ text: plainText(value), bold: true, color: BONE, font: INTER })] })],
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
                ? [new TextRun({ text: plainText(value), bold: true, color: TEAL_DARK, font: INTER })]
                : inlineRuns(value, GRAPHITE, INTER),
            }),
          ],
        });
      }),
    });
  });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] });
}

function listLevel(line: string): number {
  const leading = line.length - line.trimStart().length;
  if (leading >= 5) {
    return 2;
  }
  if (leading >= 2) {
    return 1;
  }
  return 0;
}

interface ParsedBody {
  blocks: Array<Paragraph | Table>;
  orderedListRefs: string[];
}

function parseBody(markdown: string): ParsedBody {
  const lines = markdown.split(/\r?\n/);
  const blocks: Array<Paragraph | Table> = [];
  const orderedListRefs: string[] = [];
  let activeListRef: string | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      activeListRef = null;
      i += 1;
      continue;
    }
    if (trimmed.startsWith('|') && (lines[i + 1] ?? '').includes('---')) {
      activeListRef = null;
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
      activeListRef = null;
      blocks.push(minorHeading(trimmed.slice(4)));
    } else if (trimmed.startsWith('## ')) {
      activeListRef = null;
      blocks.push(subHeading(trimmed.slice(3)));
    } else if (trimmed.startsWith('# ')) {
      activeListRef = null;
      blocks.push(banner(trimmed.slice(2)));
    } else if (/^[-*]\s+/.test(trimmed)) {
      blocks.push(bodyParagraph(trimmed.replace(/^[-*]\s+/, ''), { bullet: { level: listLevel(line) } }));
    } else if (/^\d+\.\s+/.test(trimmed)) {
      if (activeListRef === null) {
        activeListRef = `ordered-${orderedListRefs.length + 1}`;
        orderedListRefs.push(activeListRef);
      }
      blocks.push(
        bodyParagraph(trimmed.replace(/^\d+\.\s+/, ''), {
          numbering: { reference: activeListRef, level: listLevel(line) },
        }),
      );
    } else {
      activeListRef = null;
      blocks.push(bodyParagraph(trimmed));
    }
    i += 1;
  }
  return { blocks, orderedListRefs };
}

function orderedNumberingConfig(references: string[]): Array<{
  reference: string;
  levels: Array<{
    level: number;
    format: (typeof LevelFormat)[keyof typeof LevelFormat];
    text: string;
    alignment: (typeof AlignmentType)['START'];
    style: { paragraph: { indent: { left: number; hanging: number } } };
  }>;
}> {
  const levels = [
    { level: 0, format: LevelFormat.DECIMAL, text: '%1.' },
    { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2)' },
    { level: 2, format: LevelFormat.LOWER_ROMAN, text: '%3.' },
  ];
  return references.map((reference) => ({
    reference,
    levels: levels.map((entry) => ({
      ...entry,
      alignment: AlignmentType.START,
      style: { paragraph: { indent: { left: 720 * (entry.level + 1), hanging: 360 } } },
    })),
  }));
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
  const body = parseBody(job.bodyMarkdown);
  const document = new Document({
    creator: 'The Reviewer',
    title: job.title,
    description: '',
    styles: {
      default: {
        document: { run: { font: INTER, size: 20, color: GRAPHITE } },
      },
      paragraphStyles: [
        {
          id: 'Normal',
          name: 'Normal',
          quickFormat: true,
          run: { font: INTER, size: 20, color: GRAPHITE },
          paragraph: {},
        },
      ],
    },
    ...(body.orderedListRefs.length > 0 ? { numbering: { config: orderedNumberingConfig(body.orderedListRefs) } } : {}),
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
                  new TextRun({ text: ' of ', color: GREY, font: INTER, size: 16 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], color: GREY, font: MONO, size: 16 }),
                ],
              }),
            ],
          }),
        },
        children: [...titleBlock(job), ...body.blocks],
      },
    ],
  });
  return Packer.toBuffer(document);
}
