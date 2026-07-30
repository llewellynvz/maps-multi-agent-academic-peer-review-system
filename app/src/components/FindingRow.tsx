import type { ReactNode } from 'react';
import { SEVERITY_INFO, type Severity } from '@/lib/lenses';
import { Pill } from './ui';

export function FindingRow({
  severity,
  lensDisplay,
  headline,
  onOpen,
}: {
  severity: string;
  lensDisplay: string;
  headline: string;
  onOpen?: () => void;
}): ReactNode {
  const info = SEVERITY_INFO[severity as Severity] ?? SEVERITY_INFO.minor;
  const body = (
    <>
      <Pill tone={info.tone} label={info.label} />
      <span className="mono" style={{ fontSize: 12, color: 'var(--psy-lime)' }}>{lensDisplay}</span>
      <span style={{ flex: 1 }}>{headline}</span>
    </>
  );
  if (onOpen === undefined) {
    return <div className="ticker-row">{body}</div>;
  }
  return (
    <button type="button" className="ticker-row" onClick={onOpen} aria-haspopup="dialog">
      {body}
    </button>
  );
}
