import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readArtefact } from '../src/engine/artefacts';
import { renderDeliverableDocx, type DeliverableMetadataRow } from '../src/engine/docx';
import type { Recommendation, ShippedReportEnvelope } from '@mara/shared';

const RECOMMENDATION_LABEL: Record<string, string> = {
  accept: 'Accept',
  minor_revision: 'Minor revision',
  major_revision: 'Major revision',
  reject_and_resubmit: 'Reject and resubmit',
  reject: 'Reject',
};

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

  const reportMeta: DeliverableMetadataRow[] = [
    { label: 'Review', value: reviewId, mono: true },
    { label: 'Recommendation', value: RECOMMENDATION_LABEL[recommendation] ?? recommendation, mono: false },
    { label: 'Confidence', value: confidence.toFixed(2), mono: true },
    { label: 'Date', value: new Date().toISOString().slice(0, 10), mono: true },
  ];

  mkdirSync(outDir, { recursive: true });
  const report = await renderDeliverableDocx({
    title: 'Peer review report',
    kicker: 'Peer review',
    subtitle: `${RECOMMENDATION_LABEL[recommendation] ?? recommendation} at confidence ${confidence.toFixed(2)}.`,
    metadata: reportMeta,
    bodyMarkdown: shipped.bodyMarkdown,
    confidential: false,
  });
  const reportPath = resolve(outDir, `author-letter-rerendered-${reviewId.slice(0, 8)}.docx`);
  writeFileSync(reportPath, report);

  const notes = await renderDeliverableDocx({
    title: "Reviewer's private notes",
    kicker: 'Editor-only',
    subtitle: 'Editorial signals and run audit for the handling editor.',
    metadata: [
      { label: 'Review', value: reviewId, mono: true },
      { label: 'Recommendation', value: RECOMMENDATION_LABEL[recommendation] ?? recommendation, mono: false },
    ],
    bodyMarkdown: privateNotes.markdown,
    confidential: true,
  });
  const notesPath = resolve(outDir, `private-notes-rerendered-${reviewId.slice(0, 8)}.docx`);
  writeFileSync(notesPath, notes);

  console.log(`report ${reportPath} ${report.length} bytes`);
  console.log(`notes  ${notesPath} ${notes.length} bytes`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
