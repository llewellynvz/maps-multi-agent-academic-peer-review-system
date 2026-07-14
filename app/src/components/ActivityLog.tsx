'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { phaseIndex, phaseLabel } from '@/lib/format';

export interface LogEntry {
  key: string;
  ts: string;
  message: string;
  phase: string;
}

function groupByPhase(entries: LogEntry[]): Array<[string, LogEntry[]]> {
  const byPhase = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    const list = byPhase.get(entry.phase) ?? [];
    list.push(entry);
    byPhase.set(entry.phase, list);
  }
  return [...byPhase.entries()]
    .sort((a, b) => phaseIndex(b[0]) - phaseIndex(a[0]))
    .map(([phase, rows]) => [phase, [...rows].sort((a, b) => (a.ts < b.ts ? 1 : -1))] as [string, LogEntry[]]);
}

export function ActivityLog({ entries }: { entries: LogEntry[] }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const atLiveEdge = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el !== null && atLiveEdge.current) {
      el.scrollTop = 0;
    }
  }, [entries]);

  const groups = groupByPhase(entries);

  return (
    <div
      className="logstream"
      role="log"
      ref={ref}
      onScroll={() => {
        const el = ref.current;
        if (el !== null) {
          atLiveEdge.current = el.scrollTop < 24;
        }
      }}
    >
      {groups.length === 0 ? <span className="muted">No activity yet.</span> : null}
      {groups.map(([phase, rows]) => (
        <div key={phase}>
          <p
            style={{
              margin: '10px 0 4px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--psy-lime)',
            }}
          >
            {phaseLabel(phase)}
          </p>
          {rows.map((entry) => (
            <div key={entry.key}>
              <span className="ts">{entry.ts.slice(11, 19)}</span>
              <span className="msg">{entry.message}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
