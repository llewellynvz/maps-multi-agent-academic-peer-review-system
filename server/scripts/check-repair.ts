import { readFileSync } from 'node:fs';
import { bodyHeadings, labelAppearsInBody, tokenOverlap } from '../src/engine/grounding';

const id = process.argv[2] ?? '3353eaf5-c0ee-486d-8d3b-4aac330ddf5d';
const artefact = process.argv[3] ?? 'p7-shipped-1';
const shipped = JSON.parse(
  readFileSync(`D:/GITHUB REPOS/MARA-PLATFORM/data/blobs/${id}/engine/${artefact}.json`, 'utf8'),
) as { bodyMarkdown: string; evidenceMap: Array<{ section: string; label: string }> };
const headings = bodyHeadings(shipped.bodyMarkdown);
let unrepaired = 0;
for (const entry of shipped.evidenceMap) {
  if (labelAppearsInBody(shipped.bodyMarkdown, entry.label)) {
    continue;
  }
  let best = '';
  let bestRatio = 0;
  for (const heading of headings) {
    const overlap = tokenOverlap(entry.label, heading);
    if (overlap.ratio >= 0.6 && overlap.shared >= 3 && overlap.ratio > bestRatio) {
      best = heading;
      bestRatio = overlap.ratio;
    }
  }
  if (best !== '') {
    process.stdout.write(`REPAIRED [${entry.section}] "${entry.label.slice(0, 55)}" -> "${best.slice(0, 55)}" (${bestRatio.toFixed(2)})\n`);
  } else {
    unrepaired += 1;
    process.stdout.write(`UNREPAIRED [${entry.section}] ${entry.label.slice(0, 70)}\n`);
  }
}
process.stdout.write(`unrepaired: ${unrepaired}\n`);
