import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import type {
  PhrasingContent,
  RootContent,
  Table as MdTable,
  TableRow as MdTableRow,
} from 'mdast';
import { gfmTable } from 'micromark-extension-gfm-table';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  type ILevelsOptions,
  type INumberingOptions,
  type IParagraphOptions,
  LevelFormat,
  LevelSuffix,
  LineRuleType,
  Packer,
  PageBreak,
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
const SYMBOL = 'Symbol';
const COURIER = 'Courier New';
const WINGDINGS = 'Wingdings';

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

const BODY_SIZE = 22;
const HEADING_SIZE: Record<number, number> = { 1: 36, 2: 30, 3: 26, 4: 24 };
const FINDING_ID_G = /REV-[A-Z]{3,4}-\d{4}/g;
const BULLET_REF = 'bullet';

function indent(level: number): { left: number; hanging: number } {
  return { left: 360 * (level + 1), hanging: 360 };
}

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

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  color: string;
  font: string;
  size?: number;
}

function run(text: string, style: RunStyle, font: string): TextRun {
  return new TextRun({ text, bold: style.bold, italics: style.italics, color: style.color, font, ...(style.size !== undefined ? { size: style.size } : {}) });
}

function textRuns(value: string, style: RunStyle): TextRun[] {
  const runs: TextRun[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(FINDING_ID_G)) {
    const start = match.index;
    if (start > lastIndex) {
      runs.push(run(value.slice(lastIndex, start), style, style.font));
    }
    runs.push(run(match[0], style, MONO));
    lastIndex = start + match[0].length;
  }
  if (lastIndex < value.length) {
    runs.push(run(value.slice(lastIndex), style, style.font));
  }
  return runs;
}

function inlineRuns(nodes: PhrasingContent[], style: RunStyle): TextRun[] {
  const runs: TextRun[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        runs.push(...textRuns(node.value, style));
        break;
      case 'strong':
        runs.push(...inlineRuns(node.children, { ...style, bold: true }));
        break;
      case 'emphasis':
        runs.push(...inlineRuns(node.children, { ...style, italics: true }));
        break;
      case 'inlineCode':
        runs.push(run(node.value, style, MONO));
        break;
      case 'delete':
        runs.push(...inlineRuns(node.children, style));
        break;
      case 'break':
        runs.push(new TextRun({ break: 1 }));
        break;
      case 'link':
        runs.push(...inlineRuns(node.children, style));
        break;
      default:
        if ('children' in node && Array.isArray(node.children)) {
          runs.push(...inlineRuns(node.children as PhrasingContent[], style));
        } else if ('value' in node && typeof node.value === 'string') {
          runs.push(...textRuns(node.value, style));
        }
        break;
    }
  }
  return runs;
}

function plainInline(nodes: PhrasingContent[]): string {
  let out = '';
  for (const node of nodes) {
    if ('value' in node && typeof node.value === 'string') {
      out += node.value;
    } else if ('children' in node && Array.isArray(node.children)) {
      out += plainInline(node.children as PhrasingContent[]);
    }
  }
  return out;
}

function headingParagraph(depth: number, nodes: PhrasingContent[]): Paragraph {
  const level = Math.min(Math.max(depth, 1), 4);
  const size = HEADING_SIZE[level] ?? HEADING_SIZE[4]!;
  const color = level >= 4 ? GRAPHITE : level === 3 ? TEAL : TEAL_DARK;
  const spacingBefore = level === 1 ? 480 : level === 2 ? 340 : level === 3 ? 260 : 220;
  const spacingAfter = level === 1 ? 160 : level === 2 ? 120 : level === 3 ? 100 : 80;
  const children =
    level >= 4
      ? [new TextRun({ text: plainInline(nodes).toUpperCase(), bold: true, color, font: INTER, size, characterSpacing: 20 })]
      : inlineRuns(nodes, { color, font: INTER, bold: true, size });
  return new Paragraph({
    spacing: { before: spacingBefore, after: spacingAfter },
    keepNext: true,
    outlineLevel: level - 1,
    children,
    ...(level === 1 ? { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL_DARK, space: 4 } } } : {}),
  });
}

function bodyParagraph(nodes: PhrasingContent[], extra: Partial<IParagraphOptions> = {}): Paragraph {
  return new Paragraph({
    children: inlineRuns(nodes, { color: GRAPHITE, font: INTER }),
    ...extra,
  });
}

interface RenderContext {
  blocks: Array<Paragraph | Table>;
  orderedStarts: Set<number>;
  usesBullet: boolean;
  instance: number;
}

function tableFrom(node: MdTable): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER };
  const borders = { top: border, bottom: border, left: border, right: border };
  const margins = { top: 80, bottom: 80, left: 120, right: 120 };
  const rows = node.children.map((row: MdTableRow, rowIndex: number) => {
    const isHeader = rowIndex === 0;
    const fill = isHeader ? TEAL : rowIndex % 2 === 1 ? TEAL_TINT : BONE;
    return new TableRow({
      tableHeader: isHeader,
      children: row.children.map((cell, cellIndex) => {
        const isFirstCol = cellIndex === 0 && !isHeader;
        const style: RunStyle = isHeader
          ? { color: BONE, font: INTER, bold: true }
          : isFirstCol
            ? { color: TEAL_DARK, font: INTER, bold: true }
            : { color: GRAPHITE, font: INTER };
        return new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill },
          borders,
          margins,
          children: [new Paragraph({ children: inlineRuns(cell.children, style) })],
        });
      }),
    });
  });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

function renderList(node: Extract<RootContent, { type: 'list' }>, level: number, ctx: RenderContext): void {
  const ordered = node.ordered === true;
  const start = typeof node.start === 'number' ? node.start : 1;
  if (ordered) {
    ctx.orderedStarts.add(start);
  } else {
    ctx.usesBullet = true;
  }
  const reference = ordered ? `ordered-${start}` : BULLET_REF;
  const instance = ctx.instance++;
  for (const item of node.children) {
    let markerPlaced = false;
    for (const child of item.children) {
      if (child.type === 'list') {
        renderList(child, level + 1, ctx);
        continue;
      }
      const inlineNodes = child.type === 'paragraph' ? child.children : 'children' in child ? (child.children as PhrasingContent[]) : [];
      if (!markerPlaced) {
        markerPlaced = true;
        ctx.blocks.push(
          bodyParagraph(inlineNodes, {
            numbering: { reference, level, instance },
          }),
        );
      } else {
        ctx.blocks.push(bodyParagraph(inlineNodes, { indent: { left: 360 * (level + 1) } }));
      }
    }
  }
}

function renderBlocks(nodes: RootContent[], ctx: RenderContext): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'heading':
        ctx.blocks.push(headingParagraph(node.depth, node.children));
        break;
      case 'paragraph':
        ctx.blocks.push(bodyParagraph(node.children));
        break;
      case 'list':
        renderList(node, 0, ctx);
        break;
      case 'table':
        ctx.blocks.push(tableFrom(node));
        break;
      case 'thematicBreak':
        ctx.blocks.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER } }, spacing: { before: 120, after: 120 }, children: [] }));
        break;
      case 'blockquote':
        renderBlocks(node.children, ctx);
        break;
      case 'code':
        ctx.blocks.push(new Paragraph({ children: [new TextRun({ text: node.value, font: MONO, color: GRAPHITE, size: 20 })] }));
        break;
      default:
        if ('children' in node && Array.isArray(node.children)) {
          ctx.blocks.push(bodyParagraph(node.children as PhrasingContent[]));
        }
        break;
    }
  }
}

interface ParsedBody {
  blocks: Array<Paragraph | Table>;
  orderedStarts: number[];
  usesBullet: boolean;
}

function parseBody(markdown: string): ParsedBody {
  const tree = fromMarkdown(markdown, { extensions: [gfmTable()], mdastExtensions: [gfmTableFromMarkdown()] });
  const ctx: RenderContext = { blocks: [], orderedStarts: new Set(), usesBullet: false, instance: 0 };
  renderBlocks(tree.children, ctx);
  return { blocks: ctx.blocks, orderedStarts: [...ctx.orderedStarts], usesBullet: ctx.usesBullet };
}

function numberingConfig(orderedStarts: number[], usesBullet: boolean): INumberingOptions['config'] {
  const config: Array<{ reference: string; levels: ILevelsOptions[] }> = [];
  if (usesBullet) {
    config.push({
      reference: BULLET_REF,
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: '\u{F0B7}', alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { run: { font: SYMBOL, size: BODY_SIZE, color: TEAL }, paragraph: { indent: indent(0) } } },
        { level: 1, format: LevelFormat.BULLET, text: 'o', alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { run: { font: COURIER, size: 18, color: TEAL }, paragraph: { indent: indent(1) } } },
        { level: 2, format: LevelFormat.BULLET, text: '\u{F0A7}', alignment: AlignmentType.LEFT, suffix: LevelSuffix.TAB, style: { run: { font: WINGDINGS, size: 18, color: TEAL }, paragraph: { indent: indent(2) } } },
      ],
    });
  }
  for (const start of orderedStarts) {
    config.push({
      reference: `ordered-${start}`,
      levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', start, alignment: AlignmentType.START, suffix: LevelSuffix.TAB, style: { paragraph: { indent: indent(0) } } },
        { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2)', start: 1, alignment: AlignmentType.START, suffix: LevelSuffix.TAB, style: { paragraph: { indent: indent(1) } } },
        { level: 2, format: LevelFormat.LOWER_ROMAN, text: '%3.', start: 1, alignment: AlignmentType.START, suffix: LevelSuffix.TAB, style: { paragraph: { indent: indent(2) } } },
      ],
    });
  }
  return config;
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

function emptyHeader(): Header {
  return new Header({ children: [new Paragraph({ children: [] })] });
}

function pageFooter(confidential: boolean): Footer {
  const prefix = confidential ? 'Confidential. Page ' : 'Page ';
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: prefix, color: GREY, font: INTER, size: 16 }),
          new TextRun({ children: [PageNumber.CURRENT], color: GREY, font: MONO, size: 16 }),
          new TextRun({ text: ' of ', color: GREY, font: INTER, size: 16 }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], color: GREY, font: MONO, size: 16 }),
        ],
      }),
    ],
  });
}

function emptyFooter(): Footer {
  return new Footer({ children: [new Paragraph({ children: [] })] });
}

function coverBlocks(job: DeliverableJob): Array<Paragraph | Table> {
  const blocks: Array<Paragraph | Table> = [];
  const panelBorder = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  const panel = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: panelBorder, bottom: panelBorder, left: panelBorder, right: panelBorder, insideHorizontal: panelBorder, insideVertical: panelBorder },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: TEAL_DARK },
            margins: { top: 520, bottom: 520, left: 360, right: 360 },
            children: [
              new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: job.kicker.toUpperCase(), color: BONE, font: INTER, bold: true, size: 18, characterSpacing: 60 })] }),
              new Paragraph({ children: [new TextRun({ text: job.title, color: BONE, font: INTER, bold: true, size: 48 })] }),
            ],
          }),
        ],
      }),
    ],
  });
  blocks.push(panel);
  blocks.push(new Paragraph({ spacing: { before: 200, after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: LIME } }, children: [] }));
  blocks.push(new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: job.subtitle, color: GREY, font: INTER, size: 24 })] }));
  if (job.metadata.length > 0) {
    const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER };
    const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
    const margins = { top: 80, bottom: 80, left: 120, right: 120 };
    const rows = job.metadata.map(
      (row) =>
        new TableRow({
          children: [
            new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: TEAL_TINT }, borders, margins, width: { size: 30, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: row.label, bold: true, color: TEAL_DARK, font: INTER })] })] }),
            new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: BONE }, borders, margins, children: [new Paragraph({ children: [new TextRun({ text: row.value, color: GRAPHITE, font: row.mono ? MONO : INTER })] })] }),
          ],
        }),
    );
    blocks.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
  }
  blocks.push(new Paragraph({ children: [new PageBreak()] }));
  return blocks;
}

export async function renderDeliverableDocx(job: DeliverableJob): Promise<Buffer> {
  const body = parseBody(job.bodyMarkdown);
  const config = numberingConfig(body.orderedStarts, body.usesBullet);
  const document = new Document({
    creator: 'The Reviewer',
    title: job.title,
    description: '',
    styles: {
      default: { document: { run: { font: INTER, size: BODY_SIZE, color: GRAPHITE } } },
      paragraphStyles: [
        {
          id: 'Normal',
          name: 'Normal',
          quickFormat: true,
          run: { font: INTER, size: BODY_SIZE, color: GRAPHITE },
          paragraph: { spacing: { line: 360, lineRule: LineRuleType.AUTO, before: 0, after: 120 } },
        },
      ],
    },
    ...(config.length > 0 ? { numbering: { config } } : {}),
    sections: [
      {
        properties: {
          titlePage: true,
          page: { size: { width: PAGE.width, height: PAGE.height }, margin: PAGE.margin },
        },
        headers: { default: letterheadBand(), first: emptyHeader() },
        footers: { default: pageFooter(job.confidential), first: emptyFooter() },
        children: [...coverBlocks(job), ...body.blocks],
      },
    ],
  });
  return Packer.toBuffer(document);
}
