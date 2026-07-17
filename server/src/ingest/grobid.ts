export interface GrobidClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface GrobidClient {
  readonly baseUrl: string;
  isAlive: () => Promise<boolean>;
  processFulltext: (pdf: Uint8Array) => Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 120000;

export function createGrobidClient(options: GrobidClientOptions): GrobidClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const isAlive = async (): Promise<boolean> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetchImpl(`${baseUrl}/api/isalive`, { signal: controller.signal });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  const processFulltext = async (pdf: Uint8Array): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const form = new FormData();
      form.append('input', new Blob([pdf], { type: 'application/pdf' }), 'manuscript.pdf');
      const response = await fetchImpl(`${baseUrl}/api/processFulltextDocument`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`GROBID returned HTTP ${response.status}`);
      }
      const tei = await response.text();
      if (tei.trim().length === 0) {
        throw new Error('GROBID returned an empty document');
      }
      return tei;
    } finally {
      clearTimeout(timer);
    }
  };

  return { baseUrl, isAlive, processFulltext };
}
