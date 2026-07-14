import type { ReactNode } from 'react';

function ordinal(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function Section({
  number,
  eyebrow,
  title,
  lead,
  children,
  actions,
}: {
  number: number;
  eyebrow: string;
  title: string;
  lead?: string;
  children?: ReactNode;
  actions?: ReactNode;
}): ReactNode {
  return (
    <section className="section">
      <div className="spread">
        <div>
          <p className="section-eyebrow">{ordinal(number)} · {eyebrow}</p>
          <h2 className="section-title">{title}</h2>
        </div>
        {actions !== undefined ? <div className="row wrap">{actions}</div> : null}
      </div>
      {lead !== undefined ? <p className="section-lead">{lead}</p> : null}
      {children}
    </section>
  );
}
