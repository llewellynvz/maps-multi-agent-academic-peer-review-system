import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildNotesJob, buildReportJob } from '../src/engine/deliverable-jobs';
import { readArtefact } from '../src/engine/artefacts';
import { renderDeliverableDocx } from '../src/engine/docx';
import type { Recommendation, ShippedReportEnvelope } from '@mara/shared';

async function main(): Promise<void> {
  const reviewId = process.argv[2];
  const outDir = process.argv[3] ?? '.';
  if (reviewId === undefined || reviewId === '') {
    throw new Error('usage: tsx rerender-docx.ts <reviewId> [outDir]');
  }
  const shipped = readArtefact<ShippedReportEnvelope>(reviewId, 'p7-shipped-final');
  const gateRecord = readArtefact<Record<string, unknown>>(reviewId, 'p7-gate-record');
  const privateNotes = readArtefact<{ markdown: string }>(reviewId, 'p7-private-notes-final');
  const recommendation = (typeof gateRecord.recommendation === 'string'
    ? gateRecord.recommendation
    : shipped.recommendation) as Recommendation;
  const confidence = typeof gateRecord.recommendationConfidence === 'number'
    ? gateRecord.recommendationConfidence
    : shipped.recommendationConfidence;
  const rubricAverage = typeof gateRecord.rubricAverage === 'number' ? gateRecord.rubricAverage : 0;
  const date = new Date().toISOString().slice(0, 10);

  mkdirSync(outDir, { recursive: true });
  const report = await renderDeliverableDocx(
    buildReportJob({
      reviewTitle: 'Peer review report',
      manuscriptTitle: null,
      recommendation,
      confidence,
      rubricAverage,
      date,
      bodyMarkdown: shipped.bodyMarkdown,
    }),
  );
  const reportPath = resolve(outDir, `author-letter-rerendered-${reviewId.slice(0, 8)}.docx`);
  writeFileSync(reportPath, report);

  const notes = await renderDeliverableDocx(
    buildNotesJob({ reviewId, recommendation, confidence, date, bodyMarkdown: privateNotes.markdown }),
  );
  const notesPath = resolve(outDir, `private-notes-rerendered-${reviewId.slice(0, 8)}.docx`);
  writeFileSync(notesPath, notes);

  console.log(`report ${reportPath} ${report.length} bytes`);
  console.log(`notes  ${notesPath} ${notes.length} bytes`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
