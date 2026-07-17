export interface SimilarityPair {
  a: string;
  b: string;
  similarity: number;
}

export interface SimilarityReport {
  count: number;
  pairs: SimilarityPair[];
  mean: number;
  median: number;
  max: number;
  aboveThreshold: SimilarityPair[];
}

const WORD = /[a-z0-9]+/g;

export function normaliseForSimilarity(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).filter((token) => token.length > 0);
}

export function shingles(tokens: string[], size: number): Set<string> {
  const set = new Set<string>();
  for (let index = 0; index + size <= tokens.length; index += 1) {
    set.add(tokens.slice(index, index + size).join(' '));
  }
  return set;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) {
    if (large.has(item)) {
      shared += 1;
    }
  }
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface SimilarityInput {
  id: string;
  text: string;
}

export function crossReviewSimilarity(
  inputs: SimilarityInput[],
  options: { shingleSize?: number; threshold?: number } = {},
): SimilarityReport {
  const size = options.shingleSize ?? 8;
  const threshold = options.threshold ?? 0.2;
  const prepared = inputs.map((input) => ({ id: input.id, grams: shingles(normaliseForSimilarity(input.text), size) }));
  const pairs: SimilarityPair[] = [];
  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const left = prepared[i]!;
      const right = prepared[j]!;
      pairs.push({ a: left.id, b: right.id, similarity: jaccard(left.grams, right.grams) });
    }
  }
  pairs.sort((left, right) => right.similarity - left.similarity);
  const values = pairs.map((pair) => pair.similarity).sort((left, right) => left - right);
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: prepared.length,
    pairs,
    mean: values.length === 0 ? 0 : sum / values.length,
    median: values.length === 0 ? 0 : (values[Math.floor(values.length / 2)] ?? 0),
    max: values.length === 0 ? 0 : (values.at(-1) ?? 0),
    aboveThreshold: pairs.filter((pair) => pair.similarity >= threshold),
  };
}
