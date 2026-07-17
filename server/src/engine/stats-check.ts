import type { Finding, SectionMap } from '@mara/shared';

function logGamma(x: number): number {
  const coefficients = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];
  const base = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let sum = 1.000000000190015;
  for (let i = 0; i < 6; i += 1) {
    sum += (coefficients[i] as number) / (x + i + 1);
  }
  return Math.log((2.5066282746310005 * sum) / x) - base;
}

function gammaSeries(a: number, x: number): number {
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let i = 0; i < 200; i += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-12) {
      break;
    }
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

function gammaContinuedFraction(a: number, x: number): number {
  const tiny = 1e-30;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 200; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) {
      d = tiny;
    }
    c = b + an / c;
    if (Math.abs(c) < tiny) {
      c = tiny;
    }
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) {
      break;
    }
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

function regularizedGammaP(a: number, x: number): number {
  if (x <= 0) {
    return 0;
  }
  return x < a + 1 ? gammaSeries(a, x) : 1 - gammaContinuedFraction(a, x);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) {
    d = tiny;
  }
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) {
      d = tiny;
    }
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) {
      c = tiny;
    }
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) {
      d = tiny;
    }
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) {
      c = tiny;
    }
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) {
      break;
    }
  }
  return h;
}

function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

export function tTwoSidedP(t: number, df: number): number {
  return regularizedIncompleteBeta(df / 2, 0.5, df / (df + t * t));
}

export function fUpperP(f: number, df1: number, df2: number): number {
  if (f <= 0) {
    return 1;
  }
  return regularizedIncompleteBeta(df2 / 2, df1 / 2, df2 / (df2 + df1 * f));
}

export function chi2UpperP(x: number, df: number): number {
  if (x <= 0) {
    return 1;
  }
  return 1 - regularizedGammaP(df / 2, x / 2);
}

export function zTwoSidedP(z: number): number {
  const abs = Math.abs(z);
  return 1 - regularizedGammaP(0.5, (abs * abs) / 2);
}

export function rTwoSidedP(r: number, df: number): number {
  const bounded = Math.min(Math.abs(r), 0.999999999999);
  if (bounded >= 1) {
    return 0;
  }
  const t = bounded * Math.sqrt(df / (1 - bounded * bounded));
  return tTwoSidedP(t, df);
}

export type TestKind = 't' | 'F' | 'r' | 'chi2' | 'z';

export interface NhstTest {
  kind: TestKind;
  df1: number | null;
  df2: number | null;
  statistic: number;
  statisticDecimals: number;
  pComparator: '=' | '<' | '>';
  pReported: number;
  pDecimals: number;
  source: string;
}

const NUMBER = String.raw`[-−–]?\s*\d*\.?\d+`;
const P_CLAUSE = String.raw`p\s*([=<>])\s*(\d*\.?\d+)`;

const TEST_PATTERNS: Array<{ kind: TestKind; pattern: RegExp; dfCount: 0 | 1 | 2 }> = [
  {
    kind: 't',
    pattern: new RegExp(String.raw`\bt\s*\(\s*(\d+(?:\.\d+)?)\s*\)\s*=\s*(${NUMBER})\s*,\s*${P_CLAUSE}`, 'gi'),
    dfCount: 1,
  },
  {
    kind: 'F',
    pattern: new RegExp(
      String.raw`\bF\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)\s*=\s*(${NUMBER})\s*,\s*${P_CLAUSE}`,
      'gi',
    ),
    dfCount: 2,
  },
  {
    kind: 'r',
    pattern: new RegExp(String.raw`\br\s*\(\s*(\d+)\s*\)\s*=\s*(${NUMBER})\s*,\s*${P_CLAUSE}`, 'gi'),
    dfCount: 1,
  },
  {
    kind: 'chi2',
    pattern: new RegExp(
      String.raw`(?:χ2|χ²|chi[- ]?squared?|X2|x²)\s*\(\s*(\d+(?:\.\d+)?)\s*(?:,\s*N\s*=\s*[\d,\s]+)?\)\s*=\s*(${NUMBER})\s*,\s*${P_CLAUSE}`,
      'g',
    ),
    dfCount: 1,
  },
  {
    kind: 'z',
    pattern: new RegExp(String.raw`\b[zZ]\s*=\s*(${NUMBER})\s*,\s*${P_CLAUSE}`, 'g'),
    dfCount: 0,
  },
];

function parseNumber(raw: string): number {
  return Number.parseFloat(raw.replace(/[−–]/g, '-').replace(/\s+/g, ''));
}

function decimalsOf(raw: string): number {
  const match = /\.(\d+)/.exec(raw);
  return match === null ? 0 : (match[1] as string).length;
}

export function extractNhstTests(text: string): NhstTest[] {
  const tests: NhstTest[] = [];
  for (const { kind, pattern, dfCount } of TEST_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match !== null) {
      const groups = match.slice(1);
      const statRaw = groups[dfCount] as string;
      const comparator = groups[dfCount + 1] as string;
      const pRaw = groups[dfCount + 2] as string;
      tests.push({
        kind,
        df1: dfCount >= 1 ? parseNumber(groups[0] as string) : null,
        df2: dfCount === 2 ? parseNumber(groups[1] as string) : null,
        statistic: parseNumber(statRaw),
        statisticDecimals: decimalsOf(statRaw),
        pComparator: comparator as NhstTest['pComparator'],
        pReported: parseNumber(pRaw),
        pDecimals: decimalsOf(pRaw),
        source: match[0].replace(/\s+/g, ' ').trim(),
      });
      match = pattern.exec(text);
    }
  }
  return tests;
}

function recomputeP(test: NhstTest, statistic: number): number | null {
  if (test.kind === 't' && test.df1 !== null) {
    return tTwoSidedP(Math.abs(statistic), test.df1);
  }
  if (test.kind === 'F' && test.df1 !== null && test.df2 !== null) {
    return fUpperP(statistic, test.df1, test.df2);
  }
  if (test.kind === 'r' && test.df1 !== null) {
    if (Math.abs(statistic) > 1) {
      return null;
    }
    return rTwoSidedP(statistic, test.df1);
  }
  if (test.kind === 'chi2' && test.df1 !== null) {
    return chi2UpperP(statistic, test.df1);
  }
  if (test.kind === 'z') {
    return zTwoSidedP(statistic);
  }
  return null;
}

export interface StatVerdict {
  test: NhstTest;
  pLow: number;
  pHigh: number;
  consistent: boolean;
  decisionError: boolean;
  oneTailedExplains: boolean;
}

function bandConsistent(test: NhstTest, pLow: number, pHigh: number): boolean {
  const halfUlp = 0.5 * 10 ** -test.pDecimals;
  if (test.pComparator === '=') {
    return pHigh >= test.pReported - halfUlp && pLow <= test.pReported + halfUlp;
  }
  if (test.pComparator === '<') {
    return pLow < test.pReported;
  }
  return pHigh > test.pReported;
}

export function checkNhstTest(test: NhstTest): StatVerdict | null {
  const halfBand = 0.5 * 10 ** -test.statisticDecimals;
  const magnitude = Math.abs(test.statistic);
  const lowMagnitude = Math.max(0, magnitude - halfBand);
  const highMagnitude = magnitude + halfBand;
  const sign = test.statistic < 0 ? -1 : 1;
  const pAtLow = recomputeP(test, sign * lowMagnitude);
  const pAtHigh = recomputeP(test, sign * highMagnitude);
  if (pAtLow === null || pAtHigh === null || Number.isNaN(pAtLow) || Number.isNaN(pAtHigh)) {
    return null;
  }
  const pLow = Math.min(pAtLow, pAtHigh);
  const pHigh = Math.max(pAtLow, pAtHigh);
  const consistent = bandConsistent(test, pLow, pHigh);

  const reportedSignificant =
    (test.pComparator === '<' && test.pReported <= 0.05) || (test.pComparator === '=' && test.pReported <= 0.05);
  const reportedNonsignificant =
    (test.pComparator === '>' && test.pReported >= 0.05) || (test.pComparator === '=' && test.pReported > 0.05);
  const decisionError = !consistent && ((reportedSignificant && pLow > 0.05) || (reportedNonsignificant && pHigh < 0.05));

  const halvable = test.kind === 't' || test.kind === 'r' || test.kind === 'z';
  const oneTailedExplains = !consistent && halvable && bandConsistent(test, pLow / 2, pHigh / 2);

  return { test, pLow, pHigh, consistent, decisionError, oneTailedExplains };
}

export function grimCheck(mean: number, n: number, decimals: number): boolean {
  if (n <= 0 || !Number.isInteger(n) || decimals <= 0) {
    return true;
  }
  if (n > 10 ** decimals) {
    return true;
  }
  const halfUlp = 0.5 * 10 ** -decimals + 1e-9;
  for (const k of [Math.floor(mean * n), Math.ceil(mean * n)]) {
    if (Math.abs(k / n - mean) <= halfUlp) {
      return true;
    }
  }
  return false;
}

export interface GrimCandidate {
  mean: number;
  decimals: number;
  n: number;
  source: string;
}

const PARENTHETICAL = /\(([^()]{1,200})\)/g;
const MEAN_IN_GROUP = /\bM\s*=\s*(\d+\.(\d+))/;
const N_IN_GROUP = /\b[nN]\s*=\s*(\d{1,5})\b/;

export function extractGrimCandidates(text: string): GrimCandidate[] {
  const candidates: GrimCandidate[] = [];
  PARENTHETICAL.lastIndex = 0;
  let match = PARENTHETICAL.exec(text);
  while (match !== null) {
    const group = match[1] as string;
    const meanMatch = MEAN_IN_GROUP.exec(group);
    const nMatch = N_IN_GROUP.exec(group);
    if (meanMatch !== null && nMatch !== null) {
      candidates.push({
        mean: Number.parseFloat(meanMatch[1] as string),
        decimals: (meanMatch[2] as string).length,
        n: Number.parseInt(nMatch[1] as string, 10),
        source: `(${group.replace(/\s+/g, ' ').trim()})`,
      });
    }
    match = PARENTHETICAL.exec(text);
  }
  return candidates;
}

function sectionAnchors(sectionMap: SectionMap): Array<{ label: string; text: string }> {
  const parts: Array<{ label: string; text: string }> = [];
  if (sectionMap.abstract !== null) {
    parts.push({ label: 'Abstract', text: sectionMap.abstract });
  }
  for (const section of sectionMap.sections) {
    parts.push({ label: section.heading ?? `Section ${section.index}`, text: section.text });
  }
  return parts;
}

function formatP(value: number): string {
  if (value < 0.001) {
    return value.toExponential(2);
  }
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
}

const PLACEHOLDER_ID = 'REV-STAT-0000';
const CAVEAT =
  'This is a deterministic recomputation signal, not a verdict: a one-tailed test, a directional hypothesis, or a correction procedure can produce a legitimately different p value.';

function inconsistencyFinding(verdict: StatVerdict, anchorLabel: string): Finding {
  const { test } = verdict;
  const range = `${formatP(verdict.pLow)} to ${formatP(verdict.pHigh)}`;
  const severity = verdict.decisionError ? 'major' : 'minor';
  const oneTailed = verdict.oneTailedExplains
    ? ' A one-tailed reading of the test would make the reported value consistent, which is worth confirming with the authors.'
    : '';
  return {
    id: PLACEHOLDER_ID,
    lens: 'STAT',
    phase: 4,
    claim: verdict.decisionError
      ? `The reported result "${test.source}" recomputes to p between ${range}, which sits on the other side of the .05 boundary from the reported value, so the stated significance does not follow from the reported statistic and degrees of freedom.${oneTailed} ${CAVEAT}`
      : `The reported result "${test.source}" recomputes to p between ${range} from its test statistic and degrees of freedom, which does not match the reported p value at the reported precision.${oneTailed} ${CAVEAT}`,
    anchor: `${anchorLabel}: ${test.source}`,
    epistemic: 'Known',
    confidence: 0.98,
    band: 'Green',
    severity,
    fixability: 'easy',
    scope: severity === 'major' ? 'editor-only' : 'author-facing',
    failureScenario:
      'A reader who recomputes the p value from the reported statistic reaches a different conclusion about the test than the manuscript states.',
    leanestFix:
      'Recompute the test from the source output, correct whichever value was mistranscribed, and state the tail convention explicitly.',
    supersedes: null,
  };
}

function grimFinding(candidate: GrimCandidate, anchorLabel: string): Finding {
  return {
    id: PLACEHOLDER_ID,
    lens: 'STAT',
    phase: 4,
    claim: `The reported mean in "${candidate.source}" cannot be produced by whole-number responses at n = ${candidate.n}: no integer total divided by ${candidate.n} rounds to ${candidate.mean.toFixed(candidate.decimals)}. If this mean averages multi-item scores or weighted values the check does not apply, so the item structure is worth confirming. This is a granularity signal, not a verdict.`,
    anchor: `${anchorLabel}: ${candidate.source}`,
    epistemic: 'Known',
    confidence: 0.9,
    band: 'Yellow',
    severity: 'moderate',
    fixability: 'easy',
    scope: 'author-facing',
    failureScenario:
      'A reported descriptive statistic that is arithmetically impossible for the stated sample size undermines confidence in the data handling.',
    leanestFix: 'State the item structure behind the mean, or correct the mean or sample size from the source data.',
    supersedes: null,
  };
}

export function deterministicStatsFindings(sectionMap: SectionMap): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const { label, text } of sectionAnchors(sectionMap)) {
    for (const test of extractNhstTests(text)) {
      const verdict = checkNhstTest(test);
      if (verdict === null || verdict.consistent) {
        continue;
      }
      const key = `${label}|${test.source}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      findings.push(inconsistencyFinding(verdict, label));
    }
    for (const candidate of extractGrimCandidates(text)) {
      if (grimCheck(candidate.mean, candidate.n, candidate.decimals)) {
        continue;
      }
      const key = `${label}|${candidate.source}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      findings.push(grimFinding(candidate, label));
    }
  }
  return findings;
}
