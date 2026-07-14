'use client';

import type { ReactNode } from 'react';
import type { StatusTone } from '@/lib/format';

const ICON_PATHS: Record<string, string> = {
  check: 'M20.3 6.3a1 1 0 0 1 0 1.4l-9.6 9.6a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 1 1 1.4-1.4l3.9 3.9 8.9-8.9a1 1 0 0 1 1.4 0z',
  dot: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  triangle: 'M12 3 2 20h20z',
  octagon: 'M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9zM10.6 8.2 12 9.6l1.4-1.4 1.4 1.4L13.4 11l1.4 1.4-1.4 1.4L12 12.4l-1.4 1.4-1.4-1.4L10.6 11 9.2 9.6z',
  upload: 'M12 3 7 8.5h3V15h4V8.5h3zM4 18h16v2H4z',
  download: 'M12 16 7 10.5h3V4h4v6.5h3zM4 18h16v2H4z',
  file: 'M6 2h8l4 4v16H6zM14 3.5V7h3.5z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  arrow: 'M13 5l7 7-7 7-1.4-1.4L16.2 13H4v-2h12.2l-4.6-4.6z',
  chevron: 'M12 15l-6-6 1.4-1.4L12 12.2l4.6-4.6L18 9z',
  gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9-1-2.1-.4a7 7 0 0 0-.6-1.5l1.2-1.8-1.4-1.4-1.8 1.2a7 7 0 0 0-1.5-.6L13.9 0h-2l-.4 2.1a7 7 0 0 0-1.5.6L8.2 1.5 6.8 2.9l1.2 1.8a7 7 0 0 0-.6 1.5L5.3 6.6v2l2.1.4a7 7 0 0 0 .6 1.5L6.8 12.3l1.4 1.4 1.8-1.2c.5.3 1 .5 1.5.6l.4 2.1h2l.4-2.1a7 7 0 0 0 1.5-.6l1.8 1.2 1.4-1.4-1.2-1.8c.3-.5.5-1 .6-1.5z',
  trash: 'M9 3h6l1 2h4v2H4V5h4zM6 8h12l-1 13H7z',
  x: 'M18.3 5.7 13.4 10.6l5.3 5.3-1.4 1.4-5.3-5.3-4.9 4.9-1.4-1.4 4.9-4.9L5.7 5.7 7.1 4.3l4.9 4.9 4.9-4.9z',
  external: 'M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14zM5 5h5v2H7v10h10v-3h2v5H5z',
  shield: 'M12 2 4 5v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V5z',
  book: 'M4 3h13a2 2 0 0 1 2 2v16l-3-2-3 2-3-2-3 2V5a2 2 0 0 1 0 0z',
  search: 'M10 3a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
  gauge: 'M12 4a9 9 0 0 0-8 13h16a9 9 0 0 0-8-13zm0 4 3 3-1.4 1.4L12 12z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  play: 'M8 5v14l11-7z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v5.4l4 2.3-1 1.7-5-2.9V7z',
};

export function Icon({ name, className }: { name: string; className?: string }): ReactNode {
  return (
    <svg className={`ico ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name] ?? ICON_PATHS.dot} />
    </svg>
  );
}

const TONE_CLASS: Record<StatusTone, string> = {
  info: 'pill-info',
  success: 'pill-success',
  warn: 'pill-warn',
  fail: 'pill-fail',
  neutral: 'pill-neutral',
};

const TONE_ICON: Record<StatusTone, string> = {
  info: 'check',
  success: 'check',
  warn: 'triangle',
  fail: 'octagon',
  neutral: 'dot',
};

export function Pill({ tone, label, icon }: { tone: StatusTone; label: string; icon?: string }): ReactNode {
  return (
    <span className={`pill ${TONE_CLASS[tone]}`}>
      <Icon name={icon ?? TONE_ICON[tone]} />
      {label}
    </span>
  );
}

export function Meter({ value, indeterminate, error }: { value?: number; indeterminate?: boolean; error?: boolean }): ReactNode {
  if (indeterminate === true) {
    return <div className="meter meter-indeterminate" role="progressbar" aria-label="Working" />;
  }
  const pct = Math.max(0, Math.min(100, (value ?? 0) * 100));
  return (
    <div className="meter" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="meter-fill" style={{ width: `${pct}%`, background: error === true ? 'var(--accent-fail)' : undefined }} />
    </div>
  );
}

export function Spinner(): ReactNode {
  return <span className="spinner" role="status" aria-label="Loading" />;
}

export function Stepper({ steps, current }: { steps: string[]; current: number }): ReactNode {
  return (
    <nav className="stepper" aria-label="Setup progress">
      {steps.map((step, index) => (
        <span key={step} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`step ${index === current ? 'active' : ''} ${index < current ? 'done' : ''}`}>
            <span className="step-dot">
              <Icon name={index < current ? 'check' : 'dot'} />
            </span>
            {step}
          </span>
          {index < steps.length - 1 ? <span className="step-sep" /> : null}
        </span>
      ))}
    </nav>
  );
}

export function StatTile({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div>
      <p className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>{label}</p>
      <span className="mono stat-num" style={{ fontSize: 22 }}>{value}</span>
    </div>
  );
}
