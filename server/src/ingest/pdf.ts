import { extractText, getDocumentProxy } from 'unpdf';

export async function extractPdfText(pdf: Uint8Array): Promise<string> {
  const document = await getDocumentProxy(pdf);
  const { text } = await extractText(document, { mergePages: true });
  return Array.isArray(text) ? text.join('\n') : text;
}
