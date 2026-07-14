import type { ReactNode } from 'react';
import type { EvidenceFinding } from '@/lib/api';
import { Icon, Pill } from '@/components/ui';
import { SEVERITY_INFO, type Severity } from '@/lib/lenses';

function severityInfo(severity: string) {
  return SEVERITY_INFO[severity as Severity] ?? null;
}

export function EvidencePanel({
  finding,
  fallbackId,
  ledgerHref,
}: {
  finding: EvidenceFinding | null;
  fallbackId: string;
  ledgerHref: string;
}): ReactNode {
  if (finding === null) {
    return (
      <div className="stack-16">
        <p className="mono" style={{ fontSize: 18, color: 'var(--psy-teal-light)', margin: 0 }}>{fallbackId}</p>
        <p className="sub" style={{ margin: 0 }}>
          The full ledger row and its manuscript anchor are available in the evidence ledger download.
        </p>
        <a className="btn btn-secondary" href={ledgerHref}>
          <Icon name="download" /> Evidence ledger
        </a>
      </div>
    );
  }

  const sev = severityInfo(finding.severity);
  return (
    <div className="stack-16">
      <div className="row wrap">
        <Pill tone="neutral" label={finding.lensDisplay} icon="search" />
        {sev !== null ? <Pill tone={sev.tone} label={sev.label} /> : null}
      </div>
      {sev !== null ? <p className="sub" style={{ margin: 0 }}>{sev.meaning}</p> : null}
      <div className="card-inset stack-8">
        <p className="section-eyebrow" style={{ margin: 0 }}>Where in the manuscript</p>
        <p className="mono" style={{ margin: 0, color: 'var(--psy-teal-light)' }}>{finding.anchor}</p>
      </div>
      <div className="stack-8">
        <p className="section-eyebrow" style={{ margin: 0 }}>What the review found</p>
        <p style={{ margin: 0, lineHeight: 1.6 }}>{finding.claim}</p>
      </div>
      {finding.recommendedAction !== null ? (
        <div className="stack-8">
          <p className="section-eyebrow" style={{ margin: 0 }}>Suggested next step</p>
          <p style={{ margin: 0, lineHeight: 1.6 }}>{finding.recommendedAction}</p>
        </div>
      ) : null}
    </div>
  );
}
