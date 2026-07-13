import { extractText, getDocumentProxy } from 'unpdf';

export async function extractPdfText(pdf: Uint8Array): Promise<string> {
  const data = new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  const document = await getDocumentProxy(data);
  const { text } = await extractText(document, { mergePages: true });
  return Array.isArray(text) ? text.join('\n') : text;
}
