import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../paths';

const cache = new Map<string, string>();

export function readKnowledgeModule(moduleFile: string): string {
  const cached = cache.get(moduleFile);
  if (cached !== undefined) {
    return cached;
  }
  const content = readFileSync(resolve(repoRoot, 'knowledge', moduleFile), 'utf8');
  cache.set(moduleFile, content);
  return content;
}

export function readKnowledgeModules(moduleFiles: string[]): string[] {
  return moduleFiles.map(readKnowledgeModule);
}

export function exemplarDir(): string {
  return resolve(repoRoot, 'knowledge', 'exemplars');
}

export function readExemplarsFrom(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.md') && entry !== 'README.md')
    .sort()
    .map((entry) => readFileSync(resolve(dir, entry), 'utf8'))
    .filter((content) => content.trim().length > 0);
}

export function readExemplars(): string[] {
  return readExemplarsFrom(exemplarDir());
}
