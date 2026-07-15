import type { ReactNode } from 'react';
import type { EvidenceFinding, PriorStressTest } from '@/lib/api';
import { alignmentSentence, humanizeOption } from '@/lib/intake';
import { Pill } from '@/components/ui';
import { Section } from '@/components/Section';

export function PriorPanel({
  number,
  data,
  findingsById,
  onFinding,
}: {
  number: number;
  data: PriorStressTest;
  findingsById: Map<string, EvidenceFinding>;
  onFinding: (id: string) => void;
}): ReactNode {
  return (
    <Section number={number} eyebrow="Your assessment" title="Your preliminary assessment, stress-tested">
      <div className="stack-16">
        <div className="row wrap">
          <Pill tone="info" label={humanizeOption(data.prior)} />
        </div>
        <p className="sub" style={{ margin: 0 }}>{alignmentSentence(data.alignment)}</p>
        <div className="grid-2">
          <div className="card-inset stack-8">
            <p className="section-eyebrow" style={{ margin: 0 }}>The strongest case for it</p>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{data.caseFor}</p>
          </div>
          <div className="card-inset stack-8">
            <p className="section-eyebrow" style={{ margin: 0 }}>The strongest case against it</p>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{data.caseAgainst}</p>
          </div>
        </div>
        {data.hingeFindingIds.length > 0 ? (
          <div className="stack-8">
            <p className="section-eyebrow" style={{ margin: 0 }}>The findings this hinges on</p>
            <div className="row wrap">
              {data.hingeFindingIds.map((findingId) => (
                <button key={findingId} className="chip" type="button" onClick={() => onFinding(findingId)}>
                  {findingsById.get(findingId)?.lensDisplay ?? 'Evidence'}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
