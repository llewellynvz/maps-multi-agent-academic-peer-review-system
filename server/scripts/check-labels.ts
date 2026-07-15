import { readFileSync } from 'node:fs';
import { labelAppearsInBody } from '../src/engine/grounding';

const id = process.argv[2] ?? '547ca7a7-a3d3-4db0-902e-93733efd9f64';
const artefact = process.argv[3] ?? 'p7-shipped-1';
const shipped = JSON.parse(
  readFileSync(`D:/GITHUB REPOS/MARA-PLATFORM/data/blobs/${id}/engine/${artefact}.json`, 'utf8'),
) as { bodyMarkdown: string; evidenceMap: Array<{ section: string; label: string }> };
const misses = shipped.evidenceMap.filter((entry) => !labelAppearsInBody(shipped.bodyMarkdown, entry.label));
process.stdout.write(`misses under fixed matcher: ${misses.length}\n`);
for (const miss of misses) {
  process.stdout.write(`STILL MISS ${miss.section} ${miss.label}\n`);
}
