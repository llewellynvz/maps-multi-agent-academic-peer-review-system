import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MaraClient } from '../../db/client';
import { runMigrations } from '../../db/migrate';
import { writeArtefact } from '../../engine/artefacts';
import { blobDir } from '../../paths';
import { getEvidenceData } from '../evidence';

let tempDir: string;
let client: MaraClient;

const REVIEW_ID = 'rev-evidence';

function insertReview(id: string): void {
  const now = new Date().toISOString();
  client.sqlite.prepare('INSERT INTO reviews (id, slug, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, id, now, now);
}

function insertFinding(id: string, scope: string, claim: string): void {
  client.sqlite
    .prepare(
      `INSERT INTO findings
       (id, review_id, agent, phase, type, claim, manuscript_anchor, epistemic_status,
        confidence, confidence_band, severity, fixability, scope, recommended_action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      REVIEW_ID,
      'specialist',
      'phase_3',
      'analysis',
      claim,
      'p. 4, line 12',
      'Known',
      0.9,
      'Yellow',
      'moderate',
      'moderate',
      scope,
      'Report the omitted effect sizes.',
      new Date().toISOString(),
    );
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mara-evidence-'));
  client = createDb(join(tempDir, 'mara.db'));
  runMigrations(client.db);
  insertReview(REVIEW_ID);
});

afterEach(() => {
  client.sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(blobDir(REVIEW_ID), { recursive: true, force: true });
});

describe('getEvidenceData editor-only invariant', () => {
  it('never serialises an editor-only finding even when the evidence map references it', () => {
    insertFinding('REV-STAT-0001', 'author_facing', 'The reported analysis lacks effect sizes.');
    insertFinding('REV-METH-0002', 'editor_only', 'Confidential concern held for the editor.');
    writeArtefact(REVIEW_ID, 'p7-shipped-final', {
      evidenceMap: [
        {
          section: 'Analysis',
          label: 'Missing effect sizes',
          anchor: 'p. 4, line 12',
          findingIds: ['REV-STAT-0001', 'REV-METH-0002'],
        },
      ],
    });

    const evidence = getEvidenceData(client.db, REVIEW_ID);

    expect(evidence.findings.map((finding) => finding.id)).toEqual(['REV-STAT-0001']);
    const mappedIds = evidence.evidenceMap.flatMap((entry) => entry.findingIds);
    expect(mappedIds).toContain('REV-STAT-0001');
    expect(mappedIds).not.toContain('REV-METH-0002');
    expect(JSON.stringify(evidence)).not.toContain('REV-METH-0002');

    const served = evidence.findings[0];
    expect(served).toMatchObject({
      lensPrefix: 'STAT',
      lensDisplay: 'Statistical',
      severity: 'moderate',
      anchor: 'p. 4, line 12',
      recommendedAction: 'Report the omitted effect sizes.',
    });
  });
});

describe('getEvidenceData legacy path', () => {
  it('returns an empty evidence map but still serves findings when the shipped artefact is absent', () => {
    insertFinding('REV-STAT-0001', 'author_facing', 'The reported analysis lacks effect sizes.');

    const evidence = getEvidenceData(client.db, REVIEW_ID);

    expect(evidence.evidenceMap).toEqual([]);
    expect(evidence.findings.map((finding) => finding.id)).toEqual(['REV-STAT-0001']);
  });
});
