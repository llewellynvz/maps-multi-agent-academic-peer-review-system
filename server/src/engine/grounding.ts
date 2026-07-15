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
  | 'id-in-prose'
  | 'machine-token'
  | 'evidence-map-mismatch'
  | null;

export interface EvidenceMapEntry {
  section: string;
  label: string;
  anchor: string;
  findingIds: string[];
}

export interface GroundingInput {
  authorFacingBody: string;
  authorFacingCitedIds: string[];
  privateNotesBody: string;
  privateNotesReferencedIds: string[];
  ledgerIds: Set<string>;
  editorOnlyIds: Set<string>;
  idFreeProse?: boolean;
  evidenceMap?: EvidenceMapEntry[];
  authorFacingAncillary?: string;
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

export function redactSupersededIds(content: string, currentIds: Set<string>): string {
  return content.replace(FINDING_ID_TOKEN, (id) => (currentIds.has(id) ? id : '[SUPERSEDED]'));
}

const QUARANTINE_MARKER = /\[\[?QUARANTINED:[^\]]*\]?\]/g;

function stripQuarantineMarkers(content: string): string {
  return content.replace(QUARANTINE_MARKER, '[QUARANTINED]');
}

const MACHINE_ENUM_TOKENS = [
  'minor_revision',
  'major_revision',
  'reject_and_resubmit',
  'editor_only',
  'author_facing',
  'revise_specialist',
  'release_gate_block',
];

const KEY_VALUE_LINE = /^(?:[\s>+-]|\*\s|\d{1,2}[.)]\s)*(decision|recommendation|confidence|verdict|severity|fixability)\s*[:=]\s*\S/gim;
const PIPE_KEY_VALUE = /\|\s*(decision|recommendation|confidence|verdict|severity|fixability)\s*[:=]/gi;
const NUMERIC_CONFIDENCE = /\bconfidence\b[*:=\s]*(?:of|at|is|was)?[*:=\s]*[01]\.\d{1,2}\b/gi;

const HEADING_LINE = /^#{1,6}\s+(.+)$/gm;
const HEADING_NUMBERING = /^(?:\d+[A-Za-z]?(?:\.\d+)*[.)]?)\s+/;

export function bodyHeadings(body: string): string[] {
  const headings: string[] = [];
  for (const match of body.matchAll(HEADING_LINE)) {
    headings.push((match[1] ?? '').replace(HEADING_NUMBERING, '').trim());
  }
  return headings;
}

export function labelAppearsInBody(body: string, label: string): boolean {
  const wanted = label.trim();
  if (body.includes(`**${wanted}`)) {
    return true;
  }
  return bodyHeadings(body).some((heading) => heading === wanted || heading.startsWith(wanted));
}

export function scanMachineTokens(content: string): string[] {
  const hits: string[] = [];
  const lower = content.toLowerCase();
  for (const token of MACHINE_ENUM_TOKENS) {
    if (lower.includes(token)) {
      hits.push(token);
    }
  }
  for (const pattern of [KEY_VALUE_LINE, PIPE_KEY_VALUE, NUMERIC_CONFIDENCE]) {
    for (const match of content.match(pattern) ?? []) {
      hits.push(match.trim());
    }
  }
  return hits;
}

export function validateGrounding(input: GroundingInput): GroundingResult {
  const failures: string[] = [];
  let kind: GroundingFailureKind = null;

  const proseIds = extractFindingIds(stripQuarantineMarkers(input.authorFacingBody));
  const authorIds = new Set<string>([
    ...input.authorFacingCitedIds,
    ...(input.idFreeProse === true ? [] : proseIds),
  ]);
  const privateIds = new Set<string>([
    ...input.privateNotesReferencedIds,
    ...extractFindingIds(stripQuarantineMarkers(input.privateNotesBody)),
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

  if (input.idFreeProse === true) {
    const ancillary = input.authorFacingAncillary ?? '';
    const inlineIds = [...proseIds, ...extractFindingIds(stripQuarantineMarkers(ancillary))];
    if (inlineIds.length > 0) {
      kind = 'id-in-prose';
      failures.push(
        `the shipped report body and rubric justifications must carry no finding ids; found inline: ${[...new Set(inlineIds)].join(', ')}`,
      );
    }
    const tokens = [...scanMachineTokens(input.authorFacingBody), ...scanMachineTokens(ancillary)];
    if (tokens.length > 0) {
      kind = 'machine-token';
      failures.push(`the shipped report body contains internal machine tokens: ${[...new Set(tokens)].join('; ')}`);
    }
  }

  if (input.evidenceMap !== undefined) {
    const mapFailures: string[] = [];
    const unionIds = new Set<string>();
    for (const entry of input.evidenceMap) {
      for (const id of entry.findingIds) {
        unionIds.add(id);
        if (!input.ledgerIds.has(id)) {
          mapFailures.push(`evidence map entry "${entry.label}" cites ${id}, which is not current in the ledger`);
        }
        if (input.editorOnlyIds.has(id)) {
          mapFailures.push(`evidence map entry "${entry.label}" cites the editor-only id ${id}`);
        }
      }
      if (entry.anchor.trim().length === 0) {
        mapFailures.push(`evidence map entry "${entry.label}" has an empty manuscript anchor`);
      }
      if (!labelAppearsInBody(input.authorFacingBody, entry.label)) {
        mapFailures.push(
          `evidence map label "${entry.label}" does not appear as a bold label or section heading in the report body`,
        );
      }
    }
    const cited = new Set(input.authorFacingCitedIds);
    const missingFromCited = [...unionIds].filter((id) => !cited.has(id));
    const extraInCited = [...cited].filter((id) => !unionIds.has(id));
    if (missingFromCited.length > 0 || extraInCited.length > 0) {
      mapFailures.push(
        `citedFindingIds must equal the union of evidence map ids (missing: ${missingFromCited.join(', ') || 'none'}; extra: ${extraInCited.join(', ') || 'none'})`,
      );
    }
    if (mapFailures.length > 0) {
      kind = 'evidence-map-mismatch';
      failures.push(...mapFailures);
    }
  }

  return { ok: failures.length === 0, kind, failures };
}
