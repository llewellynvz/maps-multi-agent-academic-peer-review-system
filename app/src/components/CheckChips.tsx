'use client';

import type { ReactNode } from 'react';

export interface CheckChipOption {
  key: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  costNote?: string;
}

export function CheckChips({ options }: { options: CheckChipOption[] }): ReactNode {
  return (
    <div className="row wrap">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className="chip"
          aria-pressed={option.checked}
          title={option.description}
          onClick={() => option.onChange(!option.checked)}
        >
          {option.label}
          {option.costNote !== undefined ? <span className="mono chip-hint">{option.costNote}</span> : null}
        </button>
      ))}
    </div>
  );
}
