'use client';

import { useParams } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api, type DeliverableView, type ReviewDetail } from '@/lib/api';
import { confidenceBand, RECOMMENDATION_LABEL } from '@/lib/format';
import { Icon, Pill, Spinner } from '@/components/ui';
import { SideDrawer } from '@/components/SideDrawer';

const FINDING_RE = /REV-[A-Z]{3,4}-\d{4}/g;

function Markdown({ text, onFinding }: { text: string; onFinding: (id: string) => void }): ReactNode {
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
                  <span className="fid" role="button" tabIndex={0} onClick={() => onFinding(ids[partIndex] as string)}
                    onKeyDown={(event) => { if (event.key === 'Enter') onFinding(ids[partIndex] as string); }}>
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

export default function ResultsPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [deliverables, setDeliverables] = useState<DeliverableView[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [tab, setTab] = useState<'report' | 'notes'>('report');
  const [notesBannerSeen, setNotesBannerSeen] = useState(false);
  const [drawerFinding, setDrawerFinding] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);

  useEffect(() => {
    const load = async (): Promise<void> => {
      const detail = await api.getReview(id).catch(() => null);
      setReview(detail);
      const list = await api.listDeliverables(id).catch(() => ({ deliverables: [] }));
      setDeliverables(list.deliverables);
      const reportText = await fetch(api.deliverableUrl(id, 'peer_review_report', 'md'), { credentials: 'include' })
        .then((response) => (response.ok ? response.text() : null))
        .catch(() => null);
      setReport(reportText);
      const notesText = await fetch(api.deliverableUrl(id, 'reviewer_private_notes', 'md'), { credentials: 'include' })
        .then((response) => (response.ok ? response.text() : null))
        .catch(() => null);
      setNotes(notesText);
    };
    void load();
  }, [id]);

  const band = useMemo(() => confidenceBand(review?.recommendationConfidence ?? null), [review]);
  const reportReleased = deliverables.some((d) => d.kind === 'peer_review_report' && d.released);

  if (review === null) {
    return <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Spinner /> Loading results</div>;
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p className="eyebrow">Results</p>
        <h1 className="h1" style={{ marginBottom: 12 }}>{review.title ?? 'Review'}</h1>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {review.recommendation !== null ? <Pill tone="info" label={RECOMMENDATION_LABEL[review.recommendation] ?? review.recommendation} /> : null}
          <Pill tone={band.tone} label={`Confidence ${band.label}`} />
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="mono stat-num" style={{ fontSize: 32 }}>
              {review.recommendationConfidence !== null ? (review.recommendationConfidence * 5).toFixed(1) : '--'}
            </span>
            <span className="muted">/ 5</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
          <a className="btn btn-primary" href={api.deliverableUrl(id, 'peer_review_report', 'docx')} aria-disabled={!reportReleased}>
            <Icon name="download" /> Download report (.docx)
          </a>
          <div style={{ position: 'relative' }}>
            <button className="btn btn-secondary" onClick={() => setDownloadOpen((open) => !open)} aria-expanded={downloadOpen}>
              More formats <Icon name="chevron" />
            </button>
            {downloadOpen ? (
              <div className="popover" style={{ top: '110%', right: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <a href={api.deliverableUrl(id, 'reviewer_private_notes', 'docx')}>Reviewer&apos;s private notes (.docx)</a>
                <a href={api.deliverableUrl(id, 'peer_review_report', 'md')}>Report (.md)</a>
                <a href={api.deliverableUrl(id, 'ledger_export', 'md')}>Evidence ledger (.md)</a>
                <a href={api.deliverableUrl(id, 'run_archive', 'zip')}>Review archive (.zip)</a>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'report'} onClick={() => setTab('report')}>Report</button>
        <button className="tab" role="tab" aria-selected={tab === 'notes'} onClick={() => { setTab('notes'); setNotesBannerSeen(false); }}>Reviewer&apos;s private notes</button>
      </div>

      {tab === 'report' ? (
        <div className="card">
          {report === null ? (
            reportReleased ? <Spinner /> : <Pill tone="warn" label="The report has not been released yet." />
          ) : (
            <Markdown text={report} onFinding={setDrawerFinding} />
          )}
        </div>
      ) : (
        <div className="card">
          {!notesBannerSeen ? (
            <div style={{ marginBottom: 16 }}>
              <Pill tone="neutral" label="These are editorial signals, not verdicts." icon="shield" />
            </div>
          ) : null}
          {notes === null ? <Pill tone="warn" label="No private notes available." /> : <Markdown text={notes} onFinding={setDrawerFinding} />}
        </div>
      )}

      <SideDrawer open={drawerFinding !== null} title="Evidence" onClose={() => setDrawerFinding(null)}>
        <p className="mono" style={{ fontSize: 18, color: 'var(--psy-teal-light)' }}>{drawerFinding}</p>
        <p className="sub" style={{ marginTop: 12 }}>The full ledger row and its manuscript anchor are available in the evidence ledger download.</p>
        <a className="btn btn-secondary" style={{ marginTop: 12 }} href={api.deliverableUrl(id, 'ledger_export', 'md')}>
          <Icon name="download" /> Evidence ledger
        </a>
      </SideDrawer>
    </div>
  );
}
