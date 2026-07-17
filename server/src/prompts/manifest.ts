import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { repoRoot } from '../paths';

const roleValueSchema = z.enum(['frontier', 'cheap', 'local']);

export const manifestSchema = z.object({
  name: z.string(),
  promptVersion: z.string(),
  phase: z.array(z.number().int()),
  role: z.union([roleValueSchema, z.record(z.string(), roleValueSchema)]),
  knowledge: z.array(z.string()),
  exemplars: z.boolean().optional(),
  modes: z.array(z.string()).optional(),
  lenses: z.array(z.string()).optional(),
});

export type AgentManifest = z.infer<typeof manifestSchema>;

export function agentDir(agentName: string): string {
  return resolve(repoRoot, 'agents', agentName);
}

export function readManifest(agentName: string): AgentManifest {
  const raw = readFileSync(resolve(agentDir(agentName), 'manifest.json'), 'utf8');
  return manifestSchema.parse(JSON.parse(raw));
}

export function readPrompt(agentName: string): string {
  return readFileSync(resolve(agentDir(agentName), 'prompt.md'), 'utf8');
}

export function roleFor(manifest: AgentManifest, mode?: string): z.infer<typeof roleValueSchema> {
  if (typeof manifest.role === 'string') {
    return manifest.role;
  }
  const key = mode ?? Object.keys(manifest.role)[0];
  const resolved = key !== undefined ? manifest.role[key] : undefined;
  if (resolved === undefined) {
    throw new Error(`Manifest for ${manifest.name} has no role for mode ${mode ?? '(default)'}`);
  }
  return resolved;
}
