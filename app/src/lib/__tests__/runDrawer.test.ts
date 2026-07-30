import { describe, expect, it } from 'vitest';
import type { EvidenceData, EvidenceFinding } from '@/lib/api';
import { resolveDrawerContent } from '@/lib/runDrawer';

function finding(id: string, claim: string): EvidenceFinding {
  return {
    id,
    lensPrefix: 'STAT',
    lensDisplay: 'Statistical',
    severity: 'major',
    anchor: 'Table 2',
    claim,
    recommendedAction: 'Recompute the statistic.',
  };
}

const evidence: EvidenceData = {
  evidenceMap: [],
  findings: [finding('REV-STAT-0001', 'The reported mean is impossible.')],
  editorOnly: [finding('REV-SIM-0001', 'An overlap signal for editorial review.')],
};

describe('resolveDrawerContent', () => {
  it('resolves an author-facing finding to its full detail', () => {
    const content = resolveDrawerContent({ mode: 'finding', findingId: 'REV-STAT-0001' }, evidence, false);
    expect(content.kind).toBe('finding');
    if (content.kind === 'finding') {
      expect(content.finding?.claim).toBe('The reported mean is impossible.');
      expect(content.finding?.anchor).toBe('Table 2');
      expect(content.finding?.recommendedAction).toBe('Recompute the statistic.');
    }
  });

  it('resolves a masked stream row to full detail through the labelled editor-only array', () => {
    const content = resolveDrawerContent({ mode: 'finding', findingId: 'REV-SIM-0001' }, evidence, false);
    expect(content.kind).toBe('finding');
    if (content.kind === 'finding') {
      expect(content.finding?.claim).toBe('An overlap signal for editorial review.');
    }
  });

  it('falls back to the id when the finding was purged by a gate retry', () => {
    const content = resolveDrawerContent({ mode: 'finding', findingId: 'REV-GONE-0001' }, evidence, false);
    expect(content).toEqual({ kind: 'finding', finding: null, fallbackId: 'REV-GONE-0001' });
  });

  it('lists all and only the editor-only findings in confidential mode', () => {
    const content = resolveDrawerContent({ mode: 'confidential' }, evidence, false);
    expect(content.kind).toBe('confidential');
    if (content.kind === 'confidential') {
      expect(content.findings.map((f) => f.id)).toEqual(['REV-SIM-0001']);
    }
  });

  it('reports loading before the evidence fetch lands', () => {
    expect(resolveDrawerContent({ mode: 'confidential' }, null, true)).toEqual({ kind: 'loading' });
    expect(resolveDrawerContent({ mode: 'finding', findingId: 'REV-STAT-0001' }, null, true)).toEqual({ kind: 'loading' });
  });

  it('reports an error instead of spinning forever when the fetch failed', () => {
    expect(resolveDrawerContent({ mode: 'confidential' }, null, false)).toEqual({ kind: 'error' });
    expect(resolveDrawerContent({ mode: 'finding', findingId: 'REV-STAT-0001' }, null, false)).toEqual({ kind: 'error' });
  });

  it('keeps showing loading for a missing id while a refresh is in flight', () => {
    const content = resolveDrawerContent({ mode: 'finding', findingId: 'REV-NEW-0009' }, evidence, true);
    expect(content).toEqual({ kind: 'loading' });
  });

  it('tolerates a payload without the editorOnly array', () => {
    const bare: EvidenceData = { evidenceMap: [], findings: evidence.findings };
    const content = resolveDrawerContent({ mode: 'confidential' }, bare, false);
    expect(content).toEqual({ kind: 'confidential', findings: [] });
  });
});
