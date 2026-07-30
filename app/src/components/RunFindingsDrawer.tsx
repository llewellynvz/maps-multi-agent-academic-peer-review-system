import type { ReactNode } from 'react';
import type { EvidenceData } from '@/lib/api';
import { resolveDrawerContent, type RunDrawerState } from '@/lib/runDrawer';
import { EvidencePanel } from '@/components/EvidencePanel';
import { SideDrawer } from '@/components/SideDrawer';
import { Icon, Spinner } from '@/components/ui';

export function RunFindingsDrawer({
  state,
  evidence,
  loading,
  ledgerHref,
  onClose,
}: {
  state: RunDrawerState | null;
  evidence: EvidenceData | null;
  loading: boolean;
  ledgerHref: string;
  onClose: () => void;
}): ReactNode {
  if (state === null) {
    return <SideDrawer open={false} title="Finding detail" onClose={onClose}>{null}</SideDrawer>;
  }
  const content = resolveDrawerContent(state, evidence, loading);
  const title = state.mode === 'confidential' ? 'Confidential signals' : 'Finding detail';
  return (
    <SideDrawer open title={title} onClose={onClose}>
      {content.kind === 'loading' ? (
        <Spinner />
      ) : content.kind === 'error' ? (
        <p className="sub muted" style={{ margin: 0 }}>
          The finding detail could not be loaded. Close this panel and try again.
        </p>
      ) : content.kind === 'finding' ? (
        <EvidencePanel finding={content.finding} fallbackId={content.fallbackId} ledgerHref={ledgerHref} />
      ) : (
        <div className="stack-16">
          <div className="row" style={{ gap: 8 }}>
            <Icon name="shield" className="ico-teal" />
            <h3 className="h3" style={{ margin: 0 }}>
              {content.findings.length} editor-only signal{content.findings.length === 1 ? '' : 's'}
            </h3>
          </div>
          <p className="sub" style={{ margin: 0 }}>
            These findings never appear in the letter or any author-facing document. They are signals for editorial
            judgement, not conclusions.
          </p>
          {content.findings.length === 0 ? (
            <p className="sub muted" style={{ margin: 0 }}>No confidential detail is available yet.</p>
          ) : (
            <div className="stack-24">
              {content.findings.map((finding) => (
                <EvidencePanel key={finding.id} finding={finding} fallbackId={finding.id} ledgerHref={ledgerHref} />
              ))}
            </div>
          )}
        </div>
      )}
    </SideDrawer>
  );
}
