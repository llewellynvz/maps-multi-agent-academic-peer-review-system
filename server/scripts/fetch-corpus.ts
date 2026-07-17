import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dataDir } from '../src/paths';

const CORPUS_ROOT = resolve(dataDir(), 'corpus');
const REVIEWER2_DIR = resolve(CORPUS_ROOT, 'reviewer2');
const F1000_DIR = resolve(CORPUS_ROOT, 'f1000');

const REVIEWER2_BASE = 'https://huggingface.co/datasets/GitBag/Reviewer2_PGE_cleaned/resolve/main';
const REVIEWER2_FILES = ['train.parquet', 'validation.parquet', 'test.parquet'];

const F1000_QUERY = process.env.CORPUS_F1000_QUERY ?? 'psychology OR wellbeing OR "mental health"';
const F1000_PAGES = Number.parseInt(process.env.CORPUS_F1000_PAGES ?? '3', 10);
const F1000_ROWS = 100;
const F1000_DELAY_MS = 700;

const REVIEWER2_LICENCE = `Reviewer2 PGE cleaned splits
Source: https://huggingface.co/datasets/GitBag/Reviewer2_PGE_cleaned
Licence: Apache-2.0
Reference: Gao, Z., Brantley, K., & Joachims, T. (2024). Reviewer2: Optimizing review generation through prompt generation. arXiv. https://doi.org/10.48550/arXiv.2402.10886
Contents: 27k papers with 99k peer reviews and aspect prompts from six venues, incorporating PeerRead and NLPeer plus OpenReview crawls.
`;

const F1000_LICENCE = `F1000Research open peer review corpus subset
Source: https://f1000research.com/extapi/ (official public API)
Licence: CC-BY 4.0 (all F1000Research content)
Contents: JATS XML per article version. Reviewer reports and author responses are embedded as sub-articles
(article-type "reviewer-report" and "response"), each report carrying its approval decision.
Query used: ${F1000_QUERY}
`;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function download(url: string, target: string): Promise<boolean> {
  if (existsSync(target)) {
    return false;
  }
  const partial = `${target}.part`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || response.body === null) {
    throw new Error(`GET ${url} returned HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(partial));
  renameSync(partial, target);
  return true;
}

async function stageReviewer2(): Promise<void> {
  mkdirSync(REVIEWER2_DIR, { recursive: true });
  writeFileSync(resolve(REVIEWER2_DIR, 'LICENCE.md'), REVIEWER2_LICENCE);
  for (const file of REVIEWER2_FILES) {
    const target = resolve(REVIEWER2_DIR, file);
    process.stdout.write(`reviewer2/${file}: `);
    const fetched = await download(`${REVIEWER2_BASE}/${file}`, target);
    process.stdout.write(fetched ? 'downloaded\n' : 'already present, skipped\n');
  }
}

async function searchF1000Dois(): Promise<string[]> {
  const dois: string[] = [];
  for (let page = 1; page <= F1000_PAGES; page += 1) {
    const url = `https://f1000research.com/extapi/search?q=${encodeURIComponent(F1000_QUERY)}&rows=${F1000_ROWS}&page=${page}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`F1000 search page ${page} returned HTTP ${response.status}`);
    }
    const xml = await response.text();
    const matches = [...xml.matchAll(/<doi>([^<]+)<\/doi>/g)].map((match) => (match[1] as string).trim());
    dois.push(...matches);
    if (matches.length < F1000_ROWS) {
      break;
    }
    await delay(F1000_DELAY_MS);
  }
  return [...new Set(dois)];
}

function doiFileName(doi: string): string {
  return `${doi.replace(/[^A-Za-z0-9.-]+/g, '_')}.xml`;
}

async function stageF1000(): Promise<void> {
  mkdirSync(F1000_DIR, { recursive: true });
  writeFileSync(resolve(F1000_DIR, 'LICENCE.md'), F1000_LICENCE);
  const dois = await searchF1000Dois();
  process.stdout.write(`f1000: ${dois.length} article DOIs from the search\n`);
  let downloaded = 0;
  let skipped = 0;
  let withReports = 0;
  for (const doi of dois) {
    const target = resolve(F1000_DIR, doiFileName(doi));
    if (existsSync(target)) {
      skipped += 1;
      continue;
    }
    const response = await fetch(`https://f1000research.com/extapi/article/xml?doi=${encodeURIComponent(doi)}`);
    if (!response.ok) {
      process.stdout.write(`f1000 ${doi}: HTTP ${response.status}, skipped\n`);
      await delay(F1000_DELAY_MS);
      continue;
    }
    const xml = await response.text();
    writeFileSync(target, xml);
    downloaded += 1;
    if (xml.includes('article-type="reviewer-report"')) {
      withReports += 1;
    }
    await delay(F1000_DELAY_MS);
  }
  process.stdout.write(`f1000: ${downloaded} downloaded (${withReports} with reviewer reports), ${skipped} already present\n`);
}

async function main(): Promise<void> {
  mkdirSync(CORPUS_ROOT, { recursive: true });
  await stageReviewer2();
  await stageF1000();
  const totals = [REVIEWER2_DIR, F1000_DIR].map((dir) => `${dir.split(/[\\/]/).pop()}: ${readdirSync(dir).length} files`);
  process.stdout.write(`\ncorpus staged under ${CORPUS_ROOT}\n${totals.join('\n')}\n`);
}

main().catch((error) => {
  process.stdout.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
