import type { ParseQuality } from '@mara/shared';
import { CONSTITUTION_FRAME } from './constitution';
import { readKnowledgeModules } from './knowledge';
import { type AgentManifest, readManifest, readPrompt } from './manifest';

export interface AssembleInput {
  mode?: string;
  lens?: string;
  parseQuality?: ParseQuality;
  manuscriptExcerpt?: string;
  artefacts?: Array<{ label: string; content: string }>;
  routingNote?: string;
}

export interface AssembledPrompt {
  system: string;
  user: string;
}

const frameCache = new Map<string, string>();

export function buildStaticFrame(agentName: string): string {
  const cached = frameCache.get(agentName);
  if (cached !== undefined) {
    return cached;
  }
  const manifest: AgentManifest = readManifest(agentName);
  const modules = readKnowledgeModules(manifest.knowledge);
  const prompt = readPrompt(agentName);
  const frame = [CONSTITUTION_FRAME, ...modules, prompt].join('\n\n');
  frameCache.set(agentName, frame);
  return frame;
}

function parseQualitySection(parseQuality: ParseQuality): string {
  const caution =
    parseQuality === 'degraded'
      ? ' The parse is degraded: section boundaries, tables, and reference extraction may be incomplete. Treat missing structure as a parse limitation, not necessarily an author omission, and lower confidence on any finding that depends on structure the parser may have dropped.'
      : ' The parse is good.';
  return `## Parse quality\nThe sanitised manuscript reached you with parse quality "${parseQuality}".${caution}`;
}

function buildUser(input: AssembleInput): string {
  const sections: string[] = [];

  if (input.parseQuality !== undefined) {
    sections.push(parseQualitySection(input.parseQuality));
  }

  const routingLines = [`Mode: ${input.mode ?? 'default'}`, `Lens: ${input.lens ?? 'not-applicable'}`];
  if (input.routingNote !== undefined && input.routingNote.length > 0) {
    routingLines.push(input.routingNote);
  }
  sections.push(`## Dispatch routing\n${routingLines.join('\n')}`);

  if (input.manuscriptExcerpt !== undefined) {
    sections.push(`## Sanitised manuscript\n${input.manuscriptExcerpt}`);
  }

  for (const artefact of input.artefacts ?? []) {
    sections.push(`## ${artefact.label}\n${artefact.content}`);
  }

  return sections.join('\n\n');
}

export function assemble(agentName: string, input: AssembleInput = {}): AssembledPrompt {
  return {
    system: buildStaticFrame(agentName),
    user: buildUser(input),
  };
}
