import type { ReactNode } from 'react';
import { Icon } from './ui';

export function EmptyState({
  icon,
  title,
  steps,
  cta,
}: {
  icon?: string;
  title: string;
  steps?: string[];
  cta?: ReactNode;
}): ReactNode {
  return (
    <div className="card stack-16" style={{ alignItems: 'flex-start' }}>
      {icon !== undefined ? <Icon name={icon} className="ico-teal" /> : null}
      <h2 className="h3" style={{ margin: 0 }}>{title}</h2>
      {steps !== undefined && steps.length > 0 ? (
        <ol className="numbered-list">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {cta !== undefined ? <div className="row wrap">{cta}</div> : null}
    </div>
  );
}
