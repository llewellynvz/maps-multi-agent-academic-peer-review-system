import { readKnowledgeModule } from '../prompts';

const FINDING_ID_TOKEN = /REV-[A-Z]{3,4}-\d{4}/g;

let bannedVerdictCache: string[] | null = null;

export function loadBannedVerdictTerms(): string[] {
  if (bannedVerdictCache !== null) {
    return bannedVerdictCache;
  }
  const module = readKnowledgeModule('01_REVIEW_GOVERNANCE.md');
  const start = module.indexOf('Banned terminology');
  const end = module.indexOf('Required signal phrasing');
  const region = start >= 0 ? module.slice(start, end >= 0 ? end : undefined) : module;
  const terms = new Set<string>();
  const pattern = /"([^"]{3,})"/g;
  let match = pattern.exec(region);
  while (match !== null) {
    const term = (match[1] ?? '').trim().toLowerCase();
    if (term.length >= 3) {
      terms.add(term);
    }
    match = pattern.exec(region);
  }
  bannedVerdictCache = [...terms];
  return bannedVerdictCache;
}

function bannedTermPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

export function extractFindingIds(text: string): string[] {
  const found = new Set<string>();
  let match = FINDING_ID_TOKEN.exec(text);
  while (match !== null) {
    found.add(match[0]);
    match = FINDING_ID_TOKEN.exec(text);
  }
  FINDING_ID_TOKEN.lastIndex = 0;
  return [...found];
}

export type GroundingFailureKind =
  | 'ungrounded-id'
  | 'editor-only-leak'
  | 'banned-verdict-term'
  | null;

export interface GroundingInput {
  authorFacingBody: string;
  authorFacingCitedIds: string[];
  privateNotesBody: string;
  privateNotesReferencedIds: string[];
  ledgerIds: Set<string>;
  editorOnlyIds: Set<string>;
}

export interface GroundingResult {
  ok: boolean;
  kind: GroundingFailureKind;
  failures: string[];
}

export function redactEditorOnlyIds(content: string, editorOnlyIds: Set<string>): string {
  let result = content;
  for (const id of editorOnlyIds) {
    result = result.split(id).join('[EDITOR-ONLY]');
  }
  return result;
}

export function validateGrounding(input: GroundingInput): GroundingResult {
  const failures: string[] = [];
  let kind: GroundingFailureKind = null;

  const authorIds = new Set<string>([
    ...input.authorFacingCitedIds,
    ...extractFindingIds(input.authorFacingBody),
  ]);
  const privateIds = new Set<string>([
    ...input.privateNotesReferencedIds,
    ...extractFindingIds(input.privateNotesBody),
  ]);

  const ungrounded = [...authorIds, ...privateIds].filter((id) => !input.ledgerIds.has(id));
  if (ungrounded.length > 0) {
    kind = 'ungrounded-id';
    failures.push(
      `finding ids cited in the deliverables are not current in the ledger: ${[...new Set(ungrounded)].join(', ')}`,
    );
  }

  const leaked = [...authorIds].filter((id) => input.editorOnlyIds.has(id));
  if (leaked.length > 0) {
    kind = 'editor-only-leak';
    failures.push(`author-facing text references editor-only finding ids: ${[...new Set(leaked)].join(', ')}`);
  }

  const bannedHits = loadBannedVerdictTerms().filter((term) => bannedTermPattern(term).test(input.authorFacingBody));
  if (bannedHits.length > 0) {
    kind = 'banned-verdict-term';
    failures.push(`author-facing text contains banned verdict terminology: ${bannedHits.join(', ')}`);
  }

  return { ok: failures.length === 0, kind, failures };
}
