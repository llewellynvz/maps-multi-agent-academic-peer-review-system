import { readFileSync, writeFileSync } from 'node:fs';
import { buildIngestMastra, resumeIngest } from '../src/workflow/index';
import { buildSliceBContext } from './lib/slice-b-context';

interface Handoff {
  reviewId: string;
  runId: string;
  answers: Record<string, string>;
  resumeStatus?: string;
}

const handoffPath = process.argv[2];
if (handoffPath === undefined) {
  console.error('CHILD missing handoff path argument');
  process.exit(2);
}

const handoff = JSON.parse(readFileSync(handoffPath, 'utf8')) as Handoff;
const ctx = buildSliceBContext();
const mastra = buildIngestMastra({
  db: ctx.db,
  runDispatch: ctx.runDispatch,
  grobid: ctx.grobid,
  mastraDbPath: ctx.mastraDbPath,
});

console.log(`CHILD pid ${process.pid} resuming run ${handoff.runId}`);
const result = await resumeIngest(mastra, handoff.runId, { answers: handoff.answers });
console.log(`CHILD resume status ${result.status}`);
writeFileSync(handoffPath, JSON.stringify({ ...handoff, resumeStatus: result.status }, null, 2));
ctx.sqlite.close();
process.exit(result.status === 'success' ? 0 : 1);
