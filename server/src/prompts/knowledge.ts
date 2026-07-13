import { readFileSync } from 'node:fs';
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
