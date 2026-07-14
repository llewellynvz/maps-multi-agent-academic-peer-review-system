import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  actions?: ReactNode;
}): ReactNode {
  return (
    <header className="spread wrap" style={{ marginBottom: 'var(--space-6)' }}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="h-display">{title}</h1>
        {sub !== undefined ? <p className="sub">{sub}</p> : null}
      </div>
      {actions !== undefined ? <div className="row wrap">{actions}</div> : null}
    </header>
  );
}
