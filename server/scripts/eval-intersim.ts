import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../src/paths';
import { crossReviewSimilarity, type SimilarityInput } from '../src/evals/similarity';

// Offline template-reuse metric (InterSim) over stored review letters. Reads the shipped deliverable
// markdown only, never the manuscript or the PDF path, so it is free and safe to run any time.
function loadLetters(): SimilarityInput[] {
  const blobs = join(dataDir(), 'blobs');
  if (!existsSync(blobs)) {
    return [];
  }
  const letters: SimilarityInput[] = [];
  for (const reviewId of readdirSync(blobs)) {
    const letter = join(blobs, reviewId, 'output', 'author-letter.md');
    if (!existsSync(letter)) {
      continue;
    }
    const text = readFileSync(letter, 'utf8').trim();
    if (text.length > 0) {
      letters.push({ id: reviewId.slice(0, 8), text });
    }
  }
  return letters;
}

function main(): void {
  const threshold = Number.parseFloat(process.argv[2] ?? '0.2');
  const letters = loadLetters();
  if (letters.length < 2) {
    console.log(`InterSim: found ${letters.length} stored letter(s); need at least 2 to compare.`);
    return;
  }
  const report = crossReviewSimilarity(letters, { shingleSize: 8, threshold });
  console.log(`InterSim over ${report.count} stored letters (8-word shingle Jaccard)`);
  console.log(`  mean pairwise similarity:   ${report.mean.toFixed(4)}`);
  console.log(`  median pairwise similarity: ${report.median.toFixed(4)}`);
  console.log(`  max pairwise similarity:    ${report.max.toFixed(4)}`);
  console.log(`  pairs at or above ${threshold}: ${report.aboveThreshold.length} of ${report.pairs.length}`);
  console.log('\nTop 10 most similar letter pairs (template-reuse candidates):');
  for (const pair of report.pairs.slice(0, 10)) {
    console.log(`  ${pair.a}  ${pair.b}  ${pair.similarity.toFixed(4)}`);
  }
}

main();
