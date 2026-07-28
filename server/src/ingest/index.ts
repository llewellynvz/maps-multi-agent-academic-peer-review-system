import type { ManuscriptParser, ParseQuality, SectionMap } from '@mara/shared';
import { docxSectionMap } from './docx';
import type { GrobidClient } from './grobid';
import { extractPdfText } from './pdf';
import { sectionMapFromPlainText } from './plaintext';
import { parseTei } from './tei';

export type ManuscriptKind = 'pdf' | 'docx';

export interface ParseDecision {
  parser: ManuscriptParser;
  parseQuality: ParseQuality;
  fallbackReason: string | null;
}

export interface IngestInput {
  bytes: Uint8Array;
  kind: ManuscriptKind;
}

export interface IngestDeps {
  grobidExtract?: (pdf: Uint8Array) => Promise<string>;
  pdfTextExtract?: (pdf: Uint8Array) => Promise<string>;
  docxToSectionMap?: (docx: Uint8Array) => Promise<SectionMap>;
  persistTei?: (tei: string) => string | Promise<string>;
  onDecision?: (decision: ParseDecision) => void;
  allowPdfFallback?: boolean;
}

export class ParseHaltError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'ParseHaltError';
  }
}

export interface IngestResult {
  sectionMap: SectionMap;
  teiPath: string | null;
  decision: ParseDecision;
}

export function kindFromMime(mimeType: string, filename: string): ManuscriptKind {
  if (/pdf/i.test(mimeType) || /\.pdf$/i.test(filename)) {
    return 'pdf';
  }
  if (/word|officedocument|docx/i.test(mimeType) || /\.docx$/i.test(filename)) {
    return 'docx';
  }
  throw new Error(`Unsupported manuscript type: mime=${mimeType} filename=${filename}`);
}

export function grobidExtractor(client: GrobidClient): (pdf: Uint8Array) => Promise<string> {
  return (pdf) => client.processFulltext(pdf);
}

export async function ingestManuscript(input: IngestInput, deps: IngestDeps = {}): Promise<IngestResult> {
  const pdfTextExtract = deps.pdfTextExtract ?? extractPdfText;
  const docxToSectionMap = deps.docxToSectionMap ?? docxSectionMap;

  if (input.kind === 'docx') {
    let sectionMap: SectionMap;
    try {
      sectionMap = await docxToSectionMap(input.bytes);
    } catch (error) {
      throw new ParseHaltError(error instanceof Error ? error.message : String(error));
    }
    const decision: ParseDecision = {
      parser: 'mammoth',
      parseQuality: sectionMap.parseQuality,
      fallbackReason: null,
    };
    deps.onDecision?.(decision);
    return { sectionMap, teiPath: null, decision };
  }

  try {
    if (deps.grobidExtract === undefined) {
      throw new Error('GROBID is not reachable for this PDF manuscript');
    }
    const tei = await deps.grobidExtract(input.bytes);
    const sectionMap = parseTei(tei);
    const teiPath = deps.persistTei !== undefined ? await deps.persistTei(tei) : null;
    const decision: ParseDecision = { parser: 'grobid', parseQuality: 'good', fallbackReason: null };
    deps.onDecision?.(decision);
    return { sectionMap, teiPath, decision };
  } catch (error) {
    const fallbackReason = error instanceof Error ? error.message : String(error);
    if (deps.allowPdfFallback !== true) {
      throw new ParseHaltError(fallbackReason);
    }
    const text = await pdfTextExtract(input.bytes);
    const sectionMap = sectionMapFromPlainText(text, 'unpdf', 'degraded');
    const decision: ParseDecision = { parser: 'unpdf', parseQuality: 'degraded', fallbackReason };
    deps.onDecision?.(decision);
    return { sectionMap, teiPath: null, decision };
  }
}

export {
  assembleSectionMap,
  type AssembleInput,
  type RawSection,
} from './assemble';
export { docxSectionMap } from './docx';
export { createGrobidClient, type GrobidClient, type GrobidClientOptions } from './grobid';
export { extractPdfText } from './pdf';
export { sectionMapFromPlainText } from './plaintext';
export { parseTei } from './tei';
