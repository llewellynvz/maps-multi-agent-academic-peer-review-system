import type { EvidenceData, EvidenceFinding } from '@/lib/api';

export type RunDrawerState = { mode: 'finding'; findingId: string } | { mode: 'confidential' };

export type DrawerContent =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'finding'; finding: EvidenceFinding | null; fallbackId: string }
  | { kind: 'confidential'; findings: EvidenceFinding[] };

export function resolveDrawerContent(
  state: RunDrawerState,
  evidence: EvidenceData | null,
  loading: boolean,
): DrawerContent {
  if (evidence === null) {
    return loading ? { kind: 'loading' } : { kind: 'error' };
  }
  if (state.mode === 'confidential') {
    return { kind: 'confidential', findings: evidence.editorOnly ?? [] };
  }
  const all = [...evidence.findings, ...(evidence.editorOnly ?? [])];
  const finding = all.find((entry) => entry.id === state.findingId) ?? null;
  if (finding === null && loading) {
    return { kind: 'loading' };
  }
  return { kind: 'finding', finding, fallbackId: state.findingId };
}
