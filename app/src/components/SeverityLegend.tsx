'use client';

import { type ReactNode, useState } from 'react';
import { SEVERITY_INFO, type Severity } from '@/lib/lenses';
import { Icon } from './ui';

const ORDER: Severity[] = ['fatal', 'major', 'moderate', 'minor', 'none'];

export function SeverityLegend(): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className="card-inset">
      <button
        className="btn btn-ghost"
        style={{ padding: '4px 0' }}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Icon name="chevron" /> What do these severities mean?
      </button>
      {open ? (
        <dl className="stack-8" style={{ margin: '12px 0 0' }}>
          {ORDER.map((level) => (
            <div key={level} className="row wrap" style={{ alignItems: 'baseline', gap: 10 }}>
              <dt style={{ minWidth: 72, fontWeight: 500, color: 'var(--fg-1)' }}>{SEVERITY_INFO[level].label}</dt>
              <dd style={{ margin: 0, flex: 1, fontSize: 'var(--fs-small)', color: 'var(--fg-3)' }}>
                {SEVERITY_INFO[level].meaning}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
