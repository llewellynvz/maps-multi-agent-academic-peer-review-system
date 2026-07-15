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
  | 'ai-trope'
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
  kinds: Exclude<GroundingFailureKind, null>[];
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

const CONNECTIVE_WORDS = 'furthermore|moreover|additionally|notably|importantly|crucially|overall';

const AI_TROPE_PATTERNS: RegExp[] = [
  new RegExp(`(?:^|[.!?]\\s+|\\n[\\s>*-]*)(${CONNECTIVE_WORDS})\\s*,`, 'gi'),
  /(?:^|[.!?]\s+|\n[\s>*-]*)in\s+(?:conclusion|summary)\s*,/gi,
  /\bit(?:'s| is)\s+worth\s+noting\b/gi,
  /\bit\s+(?:is|should\s+be|must\s+be|can\s+be|has\s+to\s+be)\s+noted\s+that\b/gi,
  /\bit\s+(?:is|should\s+be)\s+(?:important|worth|noted|noting)\s+(?:to\s+)?(?:note|remember|mention|be\s+noted)\b/gi,
  /\bplays?\s+an?\s+(?:crucial|pivotal|key|vital|significant|central|important)\s+role\b/gi,
  /\b(?:underscor|highlight|emphasiz|emphasis)\w*\s+the\s+(?:need|significance|importance|value|fact)\b/gi,
  /\bsheds?\s+light\s+on\b/gi,
  /\ba\s+testament\s+to\b/gi,
  /\bdelv\w+\s+(?:into|deeper)\b/gi,
  /\bnavigat\w+\s+the\s+(?:complex|landscape|challeng)\w*/gi,
  /\bat\s+its\s+core\b/gi,
  /\bin\s+(?:today's|the\s+realm\s+of|the\s+landscape\s+of)\b/gi,
  /\b(?:cutting[\s-]edge|groundbreaking|game[\s-]chang\w+|paradigm\s+shift)\b/gi,
  /\bseamless(?:ly)?\b/gi,
  /\bnot\s+only\b[^.!?]{0,80}\bbut\s+also\b/gi,
];

const HEADING_LINE = /^#{1,6}\s+(.+)$/gm;
const HEADING_NUMBERING = /^(?:\d+[A-Za-z]?(?:\.\d+)*[.)]?)\s+/;

export function canonicalPunctuation(value: string): string {
  return value
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’]/g, String.fromCharCode(39))
    .replace(/[“”]/g, String.fromCharCode(34))
    .replace(/ /g, ' ');
}

export function bodyHeadings(body: string): string[] {
  const headings: string[] = [];
  for (const match of canonicalPunctuation(body).matchAll(HEADING_LINE)) {
    headings.push((match[1] ?? '').replace(HEADING_NUMBERING, '').trim());
  }
  return headings;
}

function comparableLabel(value: string): string {
  return canonicalPunctuation(value).trim().replace(/[.:]+$/, '');
}

export function labelAppearsInBody(body: string, label: string): boolean {
  const canonLabel = canonicalPunctuation(label).trim();
  const escaped = canonLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\*\\*${escaped}[.:]?\\*\\*`).test(canonicalPunctuation(body))) {
    return true;
  }
  const wanted = comparableLabel(label);
  return bodyHeadings(body).some((heading) => {
    const comparable = comparableLabel(heading);
    if (comparable.length < 4) {
      return false;
    }
    if (comparable === wanted) {
      return true;
    }
    const shorter = Math.min(comparable.length, wanted.length);
    const longer = Math.max(comparable.length, wanted.length);
    if (shorter / longer < 0.7) {
      return false;
    }
    return comparable.startsWith(wanted) || wanted.startsWith(comparable);
  });
}

export function tokenOverlap(a: string, b: string): { ratio: number; shared: number } {
  const tokens = (value: string): Set<string> =>
    new Set(
      comparableLabel(value)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 1),
    );
  const setA = tokens(a);
  const setB = tokens(b);
  if (setA.size === 0 || setB.size === 0) {
    return { ratio: 0, shared: 0 };
  }
  let shared = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      shared += 1;
    }
  }
  const union = setA.size + setB.size - shared;
  return { ratio: union === 0 ? 0 : shared / union, shared };
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

export function scanAiTropes(content: string): string[] {
  const hits = new Set<string>();
  for (const pattern of AI_TROPE_PATTERNS) {
    for (const match of content.match(pattern) ?? []) {
      const cleaned = match.replace(/^[.!?\s>*-]+/, '').trim();
      if (cleaned.length > 0) {
        hits.add(cleaned.toLowerCase());
      }
    }
  }
  return [...hits];
}

const MACHINE_TOKEN_LINE = /^((?:[\s>+-]|\*\s|\d{1,2}[.)]\s)*)(decision|recommendation|confidence|verdict|severity|fixability)(\s*[:=]\s*)(\S.*)$/i;
// pre matches only mid-sentence positions (after terminal punctuation), never a line start, so a
// problem label or heading that opens with a connective is never rewritten out of sync with its map.
const CONNECTIVE_OPENER = new RegExp(`([.!?]\\s+)(${CONNECTIVE_WORDS})\\s*,\\s*(\\w)(\\S?)`, 'gi');

// Internal enum tokens are replaced with plain reviewer language rather than deleted, so a stray token becomes readable prose instead of a lost sentence.
const ENUM_HUMANISE: Array<[RegExp, string]> = [
  [/\breject_and_resubmit\b/gi, 'rejection with an invitation to resubmit'],
  [/\bmajor_revision\b/gi, 'major revision'],
  [/\bminor_revision\b/gi, 'minor revision'],
  [/\brevise_specialist\b/gi, 'further specialist review'],
  [/\brelease_gate_block\b/gi, 'a release hold'],
  [/\beditor_only\b/gi, 'editorial'],
  [/\bauthor_facing\b/gi, 'author-facing'],
];

// Word-level stock phrasings are neutralised here; structural tropes ("not only ... but also") are left to the humanise pass and ship rather than halt.
const TROPE_REPLACE: Array<[RegExp, string]> = [
  [/\bcutting[\s-]edge\b/gi, 'advanced'],
  [/\bgroundbreaking\b/gi, 'notable'],
  [/\bparadigm\s+shift\b/gi, 'marked change'],
  [/\bgame[\s-]chang\w+\b/gi, 'significant'],
  [/\bdelv(?:e|ing)\s+into\b/gi, 'examine'],
  [/\bsheds?\s+light\s+on\b/gi, 'clarifies'],
  [/\ba\s+testament\s+to\b/gi, 'evidence of'],
];

const NUMERIC_CONFIDENCE_INLINE = /\bconfidence\b[*:=\s]*(?:of|at|is|was)?[*:=\s]*[01]\.\d{1,2}\b/gi;
const PIPE_KEY_VALUE_INLINE = /\s*\|\s*(?:decision|recommendation|confidence|verdict|severity|fixability)\s*[:=]\s*[^|\n]*/gi;

function safeCapitalise(first: string, second: string): string | null {
  // Capitalise only when the next character is a lowercase letter, so a proper noun (iOS), a symbol
  // (p-value, "p values"), a digit, or punctuation after a stripped opener is never corrupted.
  if (!/[a-z]/.test(second)) {
    return null;
  }
  return first.toUpperCase() + second;
}

export function sanitiseAuthorFacingBody(body: string): { body: string; removed: string[] } {
  const removed: string[] = [];
  const kept: string[] = [];
  for (const line of body.split('\n')) {
    const match = MACHINE_TOKEN_LINE.exec(line);
    if (match === null) {
      kept.push(line);
      continue;
    }
    const [, prefix, label, sep, rest] = match;
    const value = rest!.trim();
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length >= 3) {
      removed.push(`${label}${sep!.trim()}`);
      const capped = safeCapitalise(value.charAt(0), value.charAt(1));
      kept.push(`${prefix}${capped ?? value.slice(0, 2)}${value.slice(2)}`);
      continue;
    }
    removed.push(`${label}${sep!.trim()}`);
  }
  let cleaned = kept.join('\n');
  for (const [pattern, replacement] of [...ENUM_HUMANISE, ...TROPE_REPLACE]) {
    cleaned = cleaned.replace(pattern, (hit) => {
      removed.push(hit.toLowerCase());
      return replacement;
    });
  }
  cleaned = cleaned.replace(PIPE_KEY_VALUE_INLINE, (hit) => {
    removed.push(hit.trim());
    return '';
  });
  cleaned = cleaned.replace(NUMERIC_CONFIDENCE_INLINE, (hit) => {
    removed.push(hit.trim());
    return 'confidence';
  });
  cleaned = cleaned.replace(CONNECTIVE_OPENER, (full, pre: string, conn: string, c1: string, c2: string) => {
    const capped = safeCapitalise(c1, c2);
    if (capped === null) {
      return full;
    }
    removed.push(conn.toLowerCase());
    return `${pre}${capped}`;
  });
  return { body: cleaned, removed };
}

export function validateGrounding(input: GroundingInput): GroundingResult {
  const failures: string[] = [];
  const kinds: Exclude<GroundingFailureKind, null>[] = [];
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
    kinds.push('ungrounded-id');
    failures.push(
      `finding ids cited in the deliverables are not current in the ledger: ${[...new Set(ungrounded)].join(', ')}`,
    );
  }

  const leaked = [...authorIds].filter((id) => input.editorOnlyIds.has(id));
  if (leaked.length > 0) {
    kind = 'editor-only-leak';
    kinds.push('editor-only-leak');
    failures.push(`author-facing text references editor-only finding ids: ${[...new Set(leaked)].join(', ')}`);
  }

  const bannedHits = loadBannedVerdictTerms().filter((term) => bannedTermPattern(term).test(input.authorFacingBody));
  if (bannedHits.length > 0) {
    kind = 'banned-verdict-term';
    kinds.push('banned-verdict-term');
    failures.push(`author-facing text contains banned verdict terminology: ${bannedHits.join(', ')}`);
  }

  if (input.idFreeProse === true) {
    const ancillary = input.authorFacingAncillary ?? '';
    const inlineIds = [...proseIds, ...extractFindingIds(stripQuarantineMarkers(ancillary))];
    if (inlineIds.length > 0) {
      kind = 'id-in-prose';
      kinds.push('id-in-prose');
      failures.push(
        `the shipped report body and rubric justifications must carry no finding ids; found inline: ${[...new Set(inlineIds)].join(', ')}`,
      );
    }
    const tokens = [...scanMachineTokens(input.authorFacingBody), ...scanMachineTokens(ancillary)];
    if (tokens.length > 0) {
      kind = 'machine-token';
      kinds.push('machine-token');
      failures.push(`the shipped report body contains internal machine tokens: ${[...new Set(tokens)].join('; ')}`);
    }
    const tropes = [...scanAiTropes(input.authorFacingBody), ...scanAiTropes(ancillary)];
    if (tropes.length > 0) {
      kind = 'ai-trope';
      kinds.push('ai-trope');
      failures.push(`the shipped report body contains machine-writing tells the humanize pass must remove: ${[...new Set(tropes)].join('; ')}`);
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
      kinds.push('evidence-map-mismatch');
      failures.push(...mapFailures);
    }
  }

  return { ok: failures.length === 0, kind, kinds, failures };
}
