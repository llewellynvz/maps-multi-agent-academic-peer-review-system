import type { ReactNode } from 'react';
import type { EvidenceFinding, EvidenceMapView } from '@/lib/api';
import { Section } from '@/components/Section';

export function EvidenceIndex({
  number,
  entries,
  findingsById,
  onFinding,
}: {
  number: number;
  entries: EvidenceMapView[];
  findingsById: Map<string, EvidenceFinding>;
  onFinding: (id: string) => void;
}): ReactNode {
  if (entries.length === 0) {
    return null;
  }

  const bySection = new Map<string, EvidenceMapView[]>();
  for (const entry of entries) {
    const list = bySection.get(entry.section) ?? [];
    list.push(entry);
    bySection.set(entry.section, list);
  }

  return (
    <Section
      number={number}
      eyebrow="Evidence"
      title="Evidence on demand"
      lead="Each point in the letter is backed by anchored findings. Open one to see the manuscript location, what the review found, and the suggested next step."
    >
      <div className="stack-24">
        {[...bySection.entries()].map(([section, rows]) => (
          <div key={section} className="stack-12">
            <p className="section-eyebrow" style={{ margin: 0 }}>{section}</p>
            {rows.map((row) => (
              <div key={`${row.section}::${row.label}`} className="card-inset spread wrap" style={{ gap: 'var(--space-4)' }}>
                <div className="stack-8" style={{ flex: 1, minWidth: '16ch' }}>
                  <p style={{ margin: 0, fontWeight: 500, color: 'var(--fg-1)' }}>{row.label}</p>
                  <p className="mono chip-hint" style={{ margin: 0 }}>{row.anchor}</p>
                </div>
                <div className="row wrap">
                  {row.findingIds.map((id) => (
                    <button key={id} className="chip" type="button" onClick={() => onFinding(id)}>
                      {findingsById.get(id)?.lensDisplay ?? 'Evidence'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Section>
  );
}
