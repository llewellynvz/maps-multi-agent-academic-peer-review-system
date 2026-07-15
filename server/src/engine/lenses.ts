import type { PaperType } from './options';

export interface LensDef {
  key: string;
  prefix: string;
  display: string;
  core: boolean;
}

export const LENSES: LensDef[] = [
  { key: 'novelty', prefix: 'NOV', display: 'Novelty', core: true },
  { key: 'argumentation', prefix: 'ARG', display: 'Argumentation', core: true },
  { key: 'theoretical-coherence', prefix: 'THEO', display: 'Theoretical coherence', core: true },
  { key: 'methods-and-design', prefix: 'METH', display: 'Methods and design', core: true },
  { key: 'practical-significance', prefix: 'PRAC', display: 'Practical significance', core: true },
  { key: 'ethics', prefix: 'ETH', display: 'Ethics, equity, and participants', core: true },
  { key: 'statistical', prefix: 'STAT', display: 'Statistical', core: false },
  { key: 'measurement', prefix: 'MEAS', display: 'Measurement and psychometrics', core: false },
  { key: 'qualitative', prefix: 'QUAL', display: 'Qualitative', core: false },
  { key: 'mixed-methods', prefix: 'MIX', display: 'Mixed methods', core: false },
  { key: 'causal', prefix: 'CAUS', display: 'Causal inference', core: false },
];

export const CORE_LENSES: LensDef[] = LENSES.filter((lens) => lens.core);

const NON_LENS_DISPLAY: Record<string, string> = {
  MAP: 'Manuscript mapping',
  CTX: 'Field context',
  REF: 'Reference audit',
  RPT: 'Reporting standards',
  RPX: 'Reproducibility',
  SIM: 'Integrity screening',
  AIC: 'AI-content screening',
  SWM: 'Reviewer ensemble',
  SAN: 'Manuscript screening',
};

export const PREFIX_DISPLAY: Record<string, string> = {
  ...Object.fromEntries(LENSES.map((lens) => [lens.prefix, lens.display])),
  ...NON_LENS_DISPLAY,
};

export type Preset = 'fast' | 'balanced' | 'thorough';

export function normalisePreset(value: unknown): Preset {
  if (value === 'fast' || value === 'balanced' || value === 'thorough') {
    return value;
  }
  return 'balanced';
}

function normaliseToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

export function matchLens(raw: string): LensDef | undefined {
  const token = normaliseToken(raw);
  if (token.length === 0) {
    return undefined;
  }
  for (const lens of LENSES) {
    if (token.includes(lens.prefix.toLowerCase()) && raw.toUpperCase().includes(lens.prefix)) {
      return lens;
    }
  }
  for (const lens of LENSES) {
    const keyToken = normaliseToken(lens.key);
    const displayToken = normaliseToken(lens.display);
    if (token.includes(keyToken) || keyToken.includes(token) || token.includes(displayToken)) {
      return lens;
    }
  }
  return undefined;
}

export interface ActivationEntry {
  lens: string;
  active: boolean;
}

export function selectActiveLenses(preset: Preset, activationMap: ActivationEntry[]): LensDef[] {
  if (preset === 'fast') {
    return CORE_LENSES;
  }
  if (preset === 'thorough') {
    return LENSES;
  }
  const selected = new Map<string, LensDef>();
  for (const lens of CORE_LENSES) {
    selected.set(lens.prefix, lens);
  }
  for (const entry of activationMap) {
    if (!entry.active) {
      continue;
    }
    const matched = matchLens(entry.lens);
    if (matched !== undefined) {
      selected.set(matched.prefix, matched);
    }
  }
  return LENSES.filter((lens) => selected.has(lens.prefix));
}

const NON_DATA_DESIGNS = new Set(['theory', 'commentary', 'protocol']);

export function studyDesignAffirmsData(studyDesign: string): boolean {
  return !NON_DATA_DESIGNS.has(studyDesign.toLowerCase().trim());
}

export function applyPaperTypeLensPolicy(
  active: LensDef[],
  paperType: PaperType | null,
  analystAffirmsData: boolean,
): LensDef[] {
  if (paperType === null || paperType === 'empirical') {
    return active;
  }
  const prefixes = new Set(active.map((lens) => lens.prefix));
  if (paperType === 'theoretical' || paperType === 'perspective-or-opinion') {
    if (!analystAffirmsData) {
      for (const prefix of ['METH', 'STAT', 'MEAS', 'CAUS']) {
        prefixes.delete(prefix);
      }
    }
  } else if (paperType === 'review') {
    for (const prefix of ['ARG', 'NOV', 'THEO', 'METH']) {
      prefixes.add(prefix);
    }
  } else if (paperType === 'methodological') {
    for (const prefix of ['METH', 'STAT', 'MEAS']) {
      prefixes.add(prefix);
    }
  } else if (paperType === 'case-study') {
    if (!analystAffirmsData) {
      prefixes.delete('STAT');
    }
  }
  return LENSES.filter((lens) => prefixes.has(lens.prefix));
}

const PAPER_TYPE_NOTE: Record<PaperType, string | null> = {
  empirical: null,
  theoretical:
    'This is a theoretical contribution; judge the coherence and advancement of the argument and its scholarly grounding, and do not demand empirical validation the paper does not claim.',
  'perspective-or-opinion':
    'This is a perspective piece; judge argument quality and scholarly grounding, do not demand empirical validation.',
  review:
    'This is a review; judge the search methodology, coverage, synthesis, and argument, and hold it to review-reporting norms rather than to primary-study design standards.',
  methodological:
    'This is a methodological contribution; judge the validity, statistical properties, and measurement rigour of the proposed method rather than a substantive empirical finding.',
  'case-study':
    'This is a case study; judge the depth, richness, and transferability of the case rather than statistical generalisation.',
};

export function paperTypeNote(paperType: PaperType | null): string | null {
  return paperType === null ? null : PAPER_TYPE_NOTE[paperType];
}

const SEVERITY_WEIGHT: Record<string, number> = {
  none: 0,
  minor: 1,
  moderate: 2,
  major: 3,
  fatal: 4,
};

export interface LensSeverity {
  lens: LensDef;
  severities: string[];
}

export function selectChallengeLenses(
  preset: Preset,
  active: LensDef[],
  severitiesByPrefix: Map<string, string[]>,
): LensDef[] {
  if (preset !== 'fast') {
    return active;
  }
  const ranked = [...active].sort((a, b) => {
    const scoreA = (severitiesByPrefix.get(a.prefix) ?? []).reduce((sum, s) => sum + (SEVERITY_WEIGHT[s] ?? 0), 0);
    const scoreB = (severitiesByPrefix.get(b.prefix) ?? []).reduce((sum, s) => sum + (SEVERITY_WEIGHT[s] ?? 0), 0);
    return scoreB - scoreA;
  });
  return ranked.slice(0, 3);
}

export interface SwarmProfile {
  populationSize: number;
  rounds: string;
}

export function swarmProfile(preset: Preset): SwarmProfile {
  if (preset === 'fast') {
    return { populationSize: 12, rounds: '0 to 2' };
  }
  if (preset === 'thorough') {
    return { populationSize: 48, rounds: '0 to 4' };
  }
  return { populationSize: 24, rounds: '0 to 4' };
}
