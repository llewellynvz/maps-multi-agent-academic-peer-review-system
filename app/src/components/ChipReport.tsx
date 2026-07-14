'use client';

import type { ReactNode } from 'react';

const FINDING_RE = /REV-[A-Z]{3,4}-\d{4}/g;

export function ChipReport({ text, onFinding }: { text: string; onFinding: (id: string) => void }): ReactNode {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="report-body">
      {blocks.map((block, index) => {
        const trimmed = block.trim();
        if (trimmed.startsWith('### ')) {
          return <h3 key={index}>{trimmed.slice(4)}</h3>;
        }
        if (trimmed.startsWith('## ')) {
          return <h2 key={index}>{trimmed.slice(3)}</h2>;
        }
        if (trimmed.startsWith('# ')) {
          return <h2 key={index}>{trimmed.slice(2)}</h2>;
        }
        const parts = trimmed.split(FINDING_RE);
        const ids = trimmed.match(FINDING_RE) ?? [];
        return (
          <p key={index}>
            {parts.map((part, partIndex) => (
              <span key={partIndex}>
                {part.replace(/\*\*(.+?)\*\*/g, '$1')}
                {ids[partIndex] !== undefined ? (
                  <span
                    className="fid"
                    role="button"
                    tabIndex={0}
                    onClick={() => onFinding(ids[partIndex] as string)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        onFinding(ids[partIndex] as string);
                      }
                    }}
                  >
                    {ids[partIndex]}
                  </span>
                ) : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
