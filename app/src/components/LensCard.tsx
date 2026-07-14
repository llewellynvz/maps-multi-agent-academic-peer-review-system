import type { ReactNode } from 'react';
import type { StatusTone } from '@/lib/format';
import { Pill } from './ui';

export type LensStatus = 'pending' | 'running' | 'done';

const STATUS_TONE: Record<LensStatus, StatusTone> = { pending: 'neutral', running: 'info', done: 'success' };
const STATUS_LABEL: Record<LensStatus, string> = { pending: 'Pending', running: 'Running', done: 'Done' };

export function LensCard({
  display,
  purpose,
  status,
  count,
}: {
  display: string;
  purpose: string;
  status: LensStatus;
  count: number;
}): ReactNode {
  return (
    <div className="card-inset stack-8">
      <div className="spread">
        <span style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{display}</span>
        <Pill tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
      </div>
      <p style={{ margin: 0, fontSize: 'var(--fs-small)', lineHeight: 1.5, color: 'var(--fg-3)' }}>{purpose}</p>
      <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--fg-4)' }}>
        {count} {count === 1 ? 'finding' : 'findings'}
      </span>
    </div>
  );
}
