'use client';

import type { ReactNode } from 'react';

export interface ChoiceOption {
  value: string;
  label: string;
  hint?: string;
}

export function ChoiceChips({
  options,
  value,
  onChange,
  multi,
}: {
  options: ChoiceOption[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  multi?: boolean;
}): ReactNode {
  const selected = Array.isArray(value) ? value : [value];
  const toggle = (next: string): void => {
    if (multi === true) {
      const chosen = new Set(selected);
      if (chosen.has(next)) {
        chosen.delete(next);
      } else {
        chosen.add(next);
      }
      onChange(options.filter((option) => chosen.has(option.value)).map((option) => option.value));
    } else {
      onChange(next);
    }
  };
  return (
    <div className="row wrap">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="chip"
          aria-pressed={selected.includes(option.value)}
          onClick={() => toggle(option.value)}
        >
          {option.label}
          {option.hint !== undefined ? <span className="mono chip-hint">{option.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}
