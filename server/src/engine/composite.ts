import type { CurrentFinding } from '../ledger';
import { readKnowledgeModule } from '../prompts';

export const COMPOSITE_WEIGHTS = {
  evidenceGrounding: 0.3,
  actionability: 0.25,
  decisionStability: 0.2,
  toneRisk: 0.15,
  unsupportedClaim: 0.1,
} as const;

const TONE_RISK_CAP = 5;

let bannedCache: string[] | null = null;

export function loadBannedPhrases(): string[] {
  if (bannedCache !== null) {
    return bannedCache;
  }
  const module = readKnowledgeModule('04_DEVELOPMENTAL_VOICE.md');
  const start = module.indexOf('## Banned destructive phrasing');
  const region = start >= 0 ? module.slice(start) : module;
  const phrases = new Set<string>();
  const pattern = /"([^"]{3,})"/g;
  let match = pattern.exec(region);
  while (match !== null) {
    const phrase = (match[1] ?? '').trim().toLowerCase();
    if (phrase.length >= 3) {
      phrases.add(phrase);
    }
    match = pattern.exec(region);
  }
  bannedCache = [...phrases];
  return bannedCache;
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

const FINDING_ID_TOKEN = /REV-[A-Z]{3,4}-\d{4}/;

function countUncitedClaims(body: string): { total: number; uncited: number } {
  const sentences = body
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 40 && !sentence.startsWith('#'));
  let uncited = 0;
  for (const sentence of sentences) {
    if (!FINDING_ID_TOKEN.test(sentence)) {
      uncited += 1;
    }
  }
  return { total: sentences.length, uncited };
}

export interface CompositeInput {
  currentFindings: CurrentFinding[];
  ledgerIds: Set<string>;
  citedFindingIds: string[];
  bodyMarkdown: string;
  decisionStability: number;
}

export interface CompositeResult {
  weights: typeof COMPOSITE_WEIGHTS;
  weightsSum: number;
  positiveCeiling: number;
  components: {
    evidenceGrounding: number;
    actionability: number;
    decisionStability: number;
    toneRisk: number;
    unsupportedClaim: number;
  };
  toneRiskHits: number;
  composite: number;
}

export function computeComposite(input: CompositeInput): CompositeResult {
  const cited = input.citedFindingIds;
  const grounded = cited.filter((id) => input.ledgerIds.has(id)).length;
  const evidenceGrounding = cited.length === 0 ? 0 : grounded / cited.length;

  const majors = input.currentFindings.filter(
    (finding) => finding.severity === 'major' || finding.severity === 'fatal',
  );
  const actionable = majors.filter((finding) => (finding.recommendedAction ?? '').trim().length > 0).length;
  const actionability = majors.length === 0 ? 1 : actionable / majors.length;

  const decisionStability = clamp01(input.decisionStability);

  const body = input.bodyMarkdown.toLowerCase();
  let toneRiskHits = 0;
  for (const phrase of loadBannedPhrases()) {
    if (body.includes(phrase)) {
      toneRiskHits += 1;
    }
  }
  const toneRisk = 1 - Math.min(1, toneRiskHits / TONE_RISK_CAP);

  const claims = countUncitedClaims(input.bodyMarkdown);
  const unsupportedClaim = claims.total === 0 ? 0 : Math.min(1, claims.uncited / claims.total);

  const composite = clamp01(
    COMPOSITE_WEIGHTS.evidenceGrounding * evidenceGrounding +
      COMPOSITE_WEIGHTS.actionability * actionability +
      COMPOSITE_WEIGHTS.decisionStability * decisionStability +
      COMPOSITE_WEIGHTS.toneRisk * toneRisk -
      COMPOSITE_WEIGHTS.unsupportedClaim * unsupportedClaim,
  );

  const weightsSum =
    COMPOSITE_WEIGHTS.evidenceGrounding +
    COMPOSITE_WEIGHTS.actionability +
    COMPOSITE_WEIGHTS.decisionStability +
    COMPOSITE_WEIGHTS.toneRisk +
    COMPOSITE_WEIGHTS.unsupportedClaim;

  const positiveCeiling =
    COMPOSITE_WEIGHTS.evidenceGrounding +
    COMPOSITE_WEIGHTS.actionability +
    COMPOSITE_WEIGHTS.decisionStability +
    COMPOSITE_WEIGHTS.toneRisk;

  return {
    weights: COMPOSITE_WEIGHTS,
    weightsSum,
    positiveCeiling,
    components: { evidenceGrounding, actionability, decisionStability, toneRisk, unsupportedClaim },
    toneRiskHits,
    composite,
  };
}
