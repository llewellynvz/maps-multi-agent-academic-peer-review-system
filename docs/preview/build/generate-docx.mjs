/*
 * Renders docs/PRD.md into a branded Word document (MARA-PRD.docx).
 * House-style layout on Psynalytics brand v3 typography: A4, ~2cm margins,
 * a teal (#008DA1) title band with bone text, a metadata table with a teal
 * header row, teal-dark (#006D7C) section banners, Inter headings/body,
 * JetBrains Mono metadata/IDs, teal-header tables with bone-tinted rows,
 * and a footer with "Psynalytics" left and "Page X of Y" right.
 *
 * Fonts are named, never embedded. Reuse: `npm install docx` then
 * `node generate-docx.mjs`.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const require = createRequire(import.meta.url);
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Footer,
  AlignmentType, LevelFormat, BorderStyle, WidthType, ShadingType, PageNumber,
  HeadingLevel, TabStopType,
} = require("docx");

const SRC = "D:/GITHUB REPOS/MARA-PLATFORM/docs/PRD.md";
const OUT = "D:/GITHUB REPOS/MARA-PLATFORM/docs/preview/MARA-PRD.docx";

const TEAL = "008DA1", TEAL_DARK = "006D7C", TEAL_MID = "559FB1", GRAPHITE = "2B2D2E",
  GREY = "595959", BONE = "FEFCF5", BONE2 = "F4EFE3", TEALTINT = "E8F5F7";
const HEAD = "Inter", BODY = "Inter", MONO = "JetBrains Mono";
const CW = 11906 - 1134 - 1134;

const RID_LI = /^([A-Z]{1,4}(?:-[A-Z]{1,4})*-?\d+)([.\s:])/;
const RID_CELL = /^[A-Z]{1,4}(?:-[A-Z]{1,4})*-?\d+$/;

function splitRow(l) { return l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim()); }
function parse(md) {
  const lines = md.split(/\r?\n/), blocks = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i], t = l.trim();
    if (t === "") { i++; continue; }
    if (t.startsWith("```")) {
      i++; const code = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) { code.push(lines[i]); i++; }
      i++; blocks.push({ t: "code", lines: code }); continue;
    }
    if (t.startsWith("|") && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1].trim())) {
      const header = splitRow(l); i += 2; const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(splitRow(lines[i])); i++; }
      blocks.push({ t: "table", header, rows }); continue;
    }
    if (t === "---") { blocks.push({ t: "hr" }); i++; continue; }
    if (t.startsWith("### ")) { blocks.push({ t: "h3", x: t.slice(4) }); i++; continue; }
    if (t.startsWith("## ")) { blocks.push({ t: "h2", x: t.slice(3) }); i++; continue; }
    if (t.startsWith("# ")) { blocks.push({ t: "h1", x: t.slice(2) }); i++; continue; }
    const mnum = t.match(/^(\d+)\.\s+(.*)/);
    if (mnum) { blocks.push({ t: "num", x: mnum[2] }); i++; continue; }
    if (t.startsWith("- ")) { blocks.push({ t: "bul", x: t.slice(2) }); i++; continue; }
    blocks.push({ t: "p", x: t }); i++;
  }
  const grouped = [];
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    if (b.t === "bul") { const items = [b.x]; while (k + 1 < blocks.length && blocks[k + 1].t === "bul") { items.push(blocks[k + 1].x); k++; } grouped.push({ t: "ul", items }); }
    else if (b.t === "num") { const items = [b.x]; while (k + 1 < blocks.length && blocks[k + 1].t === "num") { items.push(blocks[k + 1].x); k++; } grouped.push({ t: "ol", items }); }
    else grouped.push(b);
  }
  return grouped;
}
function headNum(x) { const m = x.match(/^(\d+(?:\.\d+)*)\.?\s+(.*)/); return m ? { num: m[1], rest: m[2] } : { num: "", rest: x }; }

function inl(text, base = {}) {
  const runs = [], re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g; let last = 0, m;
  const mk = (t, o) => new TextRun({ text: t, font: BODY, color: GRAPHITE, size: 22, ...base, ...o });
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(mk(text.slice(last, m.index)));
    if (m[2] !== undefined) runs.push(mk(m[2], { bold: true, color: TEAL_DARK }));
    else runs.push(mk(m[3], { font: MONO, color: TEAL_DARK, size: 20 }));
    last = re.lastIndex;
  }
  if (last < text.length) runs.push(mk(text.slice(last)));
  return runs.length ? runs : [mk(text)];
}
function liRuns(text) {
  const m = text.match(RID_LI);
  if (m) return [new TextRun({ text: m[1], font: MONO, color: TEAL_DARK, size: 20, bold: true }), ...inl(text.slice(m[1].length))];
  return inl(text);
}

const bd = { style: BorderStyle.SINGLE, size: 2, color: "CFE6EA" };
const borders = { top: bd, bottom: bd, left: bd, right: bd };

function titleBand() {
  const sh = { type: ShadingType.CLEAR, fill: TEAL, color: "auto" };
  const ind = { left: 150, right: 150 };
  return [
    new Paragraph({ shading: sh, indent: ind, spacing: { before: 200, after: 40, line: 260 }, children: [new TextRun({ text: "PSYNALYTICS", font: MONO, color: BONE, size: 18, characterSpacing: 60 })] }),
    new Paragraph({ shading: sh, indent: ind, spacing: { after: 40, line: 560 }, children: [new TextRun({ text: "MARA", font: HEAD, bold: true, color: BONE, size: 60 })] }),
    new Paragraph({ shading: sh, indent: ind, spacing: { after: 260, line: 300 }, children: [new TextRun({ text: "Multi-Agent Academic Peer-Review Architecture, product requirements document", font: HEAD, color: BONE, size: 22 })] }),
  ];
}
function metaTable(header, rows) {
  const c1 = Math.round(CW * 0.28), c2 = CW - c1;
  const head = new TableRow({ tableHeader: true, children: header.map((h, j) => new TableCell({
    borders, width: { size: j ? c2 : c1, type: WidthType.DXA }, shading: { fill: TEAL, type: ShadingType.CLEAR, color: "auto" },
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: h, font: HEAD, bold: true, color: BONE, size: 20 })] })],
  })) });
  const body = rows.map(([k, v], ri) => new TableRow({ children: [
    new TableCell({ borders, width: { size: c1, type: WidthType.DXA }, shading: { fill: ri % 2 ? TEALTINT : BONE, type: ShadingType.CLEAR, color: "auto" }, margins: { top: 55, bottom: 55, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: k, font: HEAD, bold: true, color: TEAL_DARK, size: 20 })] })] }),
    new TableCell({ borders, width: { size: c2, type: WidthType.DXA }, shading: { fill: ri % 2 ? TEALTINT : BONE, type: ShadingType.CLEAR, color: "auto" }, margins: { top: 55, bottom: 55, left: 120, right: 120 },
      children: [new Paragraph({ children: inl(v, { font: MONO, size: 20 }) })] }),
  ] }));
  return new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: [c1, c2], rows: [head, ...body] });
}
function contentTable(b, monoCol0 = false) {
  const n = b.header.length, col = Array(n).fill(Math.floor(CW / n));
  col[n - 1] = CW - col.slice(0, n - 1).reduce((a, c) => a + c, 0);
  const head = new TableRow({ tableHeader: true, children: b.header.map((h, j) => new TableCell({
    borders, width: { size: col[j], type: WidthType.DXA }, shading: { fill: TEAL, type: ShadingType.CLEAR, color: "auto" },
    margins: { top: 55, bottom: 55, left: 110, right: 110 },
    children: [new Paragraph({ children: [new TextRun({ text: h, font: HEAD, bold: true, color: BONE, size: 19 })] })],
  })) });
  const body = b.rows.map((r, ri) => new TableRow({ children: r.map((c, j) => {
    let runs;
    if (j === 0 && monoCol0) runs = [new TextRun({ text: c, font: MONO, color: TEAL_DARK, size: 19 })];
    else if (RID_CELL.test(c) || /^\d+$/.test(c)) runs = [new TextRun({ text: c, font: MONO, color: j === 0 ? TEAL_DARK : GRAPHITE, size: 19, bold: j === 0 })];
    else runs = inl(c, j === 0 ? { bold: true, color: TEAL_DARK, size: 21 } : { size: 21 });
    return new TableCell({ borders, width: { size: col[j], type: WidthType.DXA }, shading: { fill: ri % 2 ? TEALTINT : BONE, type: ShadingType.CLEAR, color: "auto" }, margins: { top: 50, bottom: 50, left: 110, right: 110 },
      children: [new Paragraph({ children: runs })] });
  }) }));
  return new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: col, rows: [head, ...body] });
}
function banner(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 340, after: 160, line: 300 },
    shading: { type: ShadingType.CLEAR, fill: TEAL_DARK, color: "auto" }, indent: { left: 140, right: 140 },
    children: [new TextRun({ text, font: HEAD, bold: true, color: BONE, size: 26 })] });
}
function subhead(num, rest) {
  const kids = [];
  if (num) kids.push(new TextRun({ text: num + "  ", font: MONO, color: TEAL_MID, size: 22, bold: true }));
  kids.push(new TextRun({ text: rest, font: HEAD, bold: true, color: TEAL_DARK, size: 24 }));
  return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 100 }, children: kids });
}
function codeBlock(lines) {
  return lines.map((ln, k) => new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: BONE2, color: "auto" }, indent: { left: 160, right: 160 },
    spacing: { before: k === 0 ? 120 : 0, after: k === lines.length - 1 ? 160 : 0, line: 260 },
    children: [new TextRun({ text: ln || " ", font: MONO, color: GRAPHITE, size: 18 })],
  }));
}

const annexes = [
  ["docs/prd/05-pipeline-spec.md", "Pipeline specification: the nine phases (0 to 8), the concurrency schedule that runs them, the dispatch and runtime budgets, the release-gate machinery, and per-phase failure handling."],
  ["docs/prd/06-agent-knowledge-spec.md", "Agent and knowledge specification: the agents as workflow nodes with typed schemas, the knowledge base as their behavioural contract, and the restored MARA v3.0 capabilities."],
  ["docs/prd/07-data-model.md", "Data model and storage: the append-only findings table, checkpoints and the review-events timeline, and deliverables carrying a released flag."],
  ["docs/prd/08-api-surface.md", "API surface: the local REST API for reviews, uploads, answers, run control, deliverables, settings, and stats, plus the per-run SSE stream."],
  ["docs/prd/09-ui-spec.md", "Interface specification: the seven screens, the product-app kit extension, the new warn and fail tokens, and the WCAG 2.2 AA rules."],
  ["docs/prd/10-brand-spec.md", "Brand and document design: the psynalytics-brand v3 tokens, self-hosted Inter and JetBrains Mono, and the Inter-based Word respec."],
  ["docs/prd/11-security-privacy.md", "Security and privacy: the three-tier injection quarantine, the single controlled egress client, and BYO key encryption."],
  ["docs/prd/13-observability.md", "Observability: the local stats panel, structured logging without manuscript content, and optional env-gated Langfuse wiring."],
];
function docMap() {
  const out = [banner("Document map")];
  out.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 150 }, children: inl("The master document above is the normative overview. Eight canonical annexes hold the full specifications it summarises. They live in `docs/prd/` as markdown and carry the detail behind sections 5 to 13.") }));
  out.push(contentTable({ header: ["Annex", "Contents"], rows: annexes }, true));
  out.push(new Paragraph({ spacing: { after: 140 }, children: [new TextRun({ text: "", size: 2 })] }));
  return out;
}

function build() {
  const blocks = parse(readFileSync(SRC, "utf8"));
  const firstTableIdx = blocks.findIndex((b) => b.t === "table");
  const meta = blocks[firstTableIdx];
  const rest = blocks.filter((b, idx) => {
    if (b.t === "h1") return false;
    if (b.t === "h2" && b.x.trim() === "Product requirements document") return false;
    if (idx === firstTableIdx) return false;
    if (b.t === "hr") return false;
    return true;
  });

  const body = [...titleBand(), new Paragraph({ spacing: { before: 160, after: 220 }, children: [new TextRun({ text: "", size: 2 })] }), metaTable(meta.header, meta.rows), new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "", size: 2 })] })];

  const numConfigs = [{ reference: "psy-bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT, style: { run: { color: TEAL }, paragraph: { indent: { left: 460, hanging: 240 } } } }] }];
  let olCount = 0;

  for (const b of rest) {
    if (b.t === "h2" && /^Document history/.test(b.x.trim())) docMap().forEach((p) => body.push(p));
    if (b.t === "h2") { const { num, rest: r } = headNum(b.x); body.push(banner(num ? num + ". " + r : r)); }
    else if (b.t === "h3") { const { num, rest: r } = headNum(b.x); body.push(subhead(num, r)); }
    else if (b.t === "p") body.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 150 }, children: inl(b.x) }));
    else if (b.t === "ul") b.items.forEach((x) => body.push(new Paragraph({ numbering: { reference: "psy-bul", level: 0 }, spacing: { after: 90 }, children: liRuns(x) })));
    else if (b.t === "ol") {
      const ref = "psy-num-" + olCount++;
      numConfigs.push({ reference: ref, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { run: { color: TEAL_DARK, bold: true }, paragraph: { indent: { left: 460, hanging: 300 } } } }] });
      b.items.forEach((x) => body.push(new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 90 }, children: liRuns(x) })));
    }
    else if (b.t === "table") { body.push(contentTable(b)); body.push(new Paragraph({ spacing: { after: 140 }, children: [new TextRun({ text: "", size: 2 })] })); }
    else if (b.t === "code") codeBlock(b.lines).forEach((p) => body.push(p));
  }

  const footer = new Footer({ children: [new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: CW }],
    children: [
      new TextRun({ text: "Psynalytics", font: MONO, color: GREY, size: 16 }),
      new TextRun({ text: "\t", font: MONO, size: 16 }),
      new TextRun({ text: "Page ", font: MONO, color: GREY, size: 16 }),
      new TextRun({ children: [PageNumber.CURRENT], font: MONO, color: GREY, size: 16 }),
      new TextRun({ text: " of ", font: MONO, color: GREY, size: 16 }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: MONO, color: GREY, size: 16 }),
    ],
  })] });

  const doc = new Document({
    creator: "Psynalytics", title: "MARA — Product Requirements Document", description: "MARA product requirements document",
    styles: { default: { document: { run: { font: BODY, size: 22, color: GRAPHITE } }, heading1: { run: { font: HEAD, bold: true, color: BONE, size: 26 } }, heading2: { run: { font: HEAD, bold: true, color: TEAL_DARK, size: 24 } } } },
    numbering: { config: numConfigs },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1350, left: 1134 } } },
      footers: { default: footer },
      children: body,
    }],
  });
  return Packer.toBuffer(doc).then((buf) => { writeFileSync(OUT, buf); console.log("wrote", OUT, buf.length, "bytes"); return existsSync(OUT); });
}
build().catch((e) => { console.error(e); process.exit(1); });
