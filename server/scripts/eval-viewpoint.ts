import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listReviewDirs } from '../src/evals/corpus';
import { crossReviewSimilarity, type SimilarityInput } from '../src/evals/similarity';

// Offline viewpoint-diversity metric. Within one review, each specialist lens should read the
// manuscript differently. We measure the pairwise similarity of the lenses' first-pass readings:
// LOW intra-review similarity means diverse viewpoints, which is the property the independence
// protocol is meant to produce. Reads stored p3-<LENS>-first.json artefacts only, never the manuscript.
interface SpecialistArtefact {
  lens?: string;
  coreContributionReading?: string;
  findings?: Array<{ claim?: string }>;
}

function lensDocuments(engineDir: string): SimilarityInput[] {
  const docs: SimilarityInput[] = [];
  for (const file of readdirSync(engineDir)) {
    if (!/^p3-[A-Z]+-first\.json$/.test(file)) {
      continue;
    }
    const artefact = JSON.parse(readFileSync(join(engineDir, file), 'utf8')) as SpecialistArtefact;
    const claims = (artefact.findings ?? []).map((finding) => finding.claim ?? '').join(' ');
    const text = `${artefact.coreContributionReading ?? ''} ${claims}`.trim();
    if (text.length > 0) {
      docs.push({ id: artefact.lens ?? file.replace(/^p3-|-first\.json$/g, ''), text });
    }
  }
  return docs;
}

function main(): void {
  const rows: Array<{ id: string; lenses: number; mean: number; max: number }> = [];
  for (const { reviewId, dir } of listReviewDirs()) {
    const engineDir = join(dir, 'engine');
    if (!existsSync(engineDir)) {
      continue;
    }
    const docs = lensDocuments(engineDir);
    if (docs.length < 2) {
      continue;
    }
    const report = crossReviewSimilarity(docs, { shingleSize: 5 });
    rows.push({ id: reviewId.slice(0, 8), lenses: docs.length, mean: report.mean, max: report.max });
  }
  if (rows.length === 0) {
    console.log('No reviews with two or more specialist lenses found.');
    return;
  }
  rows.sort((a, b) => b.mean - a.mean);
  console.log(`Viewpoint diversity across ${rows.length} reviews (5-word shingle Jaccard between lenses; lower is more diverse)`);
  console.log('  review    lenses  mean   max');
  for (const row of rows) {
    console.log(`  ${row.id}  ${String(row.lenses).padStart(6)}  ${row.mean.toFixed(3)}  ${row.max.toFixed(3)}`);
  }
  const overall = rows.reduce((sum, row) => sum + row.mean, 0) / rows.length;
  console.log(`\n  overall mean intra-review lens similarity: ${overall.toFixed(4)} (low = lenses genuinely disagree)`);
}

main();
