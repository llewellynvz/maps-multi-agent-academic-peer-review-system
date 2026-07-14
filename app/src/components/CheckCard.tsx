'use client';

import type { ReactNode } from 'react';
import { Icon } from './ui';

export function CheckCard({
  checked,
  onChange,
  title,
  description,
  costNote,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description?: string;
  costNote?: string;
}): ReactNode {
  return (
    <label className="card-inset check-card" data-checked={checked}>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="check-indicator" aria-hidden="true">
        {checked ? <Icon name="check" /> : null}
      </span>
      <span className="check-card-body">
        <span className="check-card-head">
          <span className="check-card-title">{title}</span>
          {costNote !== undefined ? <span className="mono check-card-cost">{costNote}</span> : null}
        </span>
        {description !== undefined ? <span className="check-card-desc">{description}</span> : null}
      </span>
    </label>
  );
}
