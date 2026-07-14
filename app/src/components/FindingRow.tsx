import type { ReactNode } from 'react';
import { SEVERITY_INFO, type Severity } from '@/lib/lenses';
import { Pill } from './ui';

export function FindingRow({
  severity,
  lensDisplay,
  headline,
}: {
  severity: string;
  lensDisplay: string;
  headline: string;
}): ReactNode {
  const info = SEVERITY_INFO[severity as Severity] ?? SEVERITY_INFO.minor;
  return (
    <div className="ticker-row">
      <Pill tone={info.tone} label={info.label} />
      <span className="mono" style={{ fontSize: 12, color: 'var(--psy-lime)' }}>{lensDisplay}</span>
      <span style={{ flex: 1 }}>{headline}</span>
    </div>
  );
}
