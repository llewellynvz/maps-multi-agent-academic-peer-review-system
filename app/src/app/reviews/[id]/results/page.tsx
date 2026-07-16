'use client';

import { useParams } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api, type DeliverableView, type EvidenceData, type ReviewDetail, type RunStats } from '@/lib/api';
import {
  confidenceSentence,
  formatBytes,
  formatDuration,
  formatUsd,
  RECOMMENDATION_EXPLANATION,
  RECOMMENDATION_LABEL,
} from '@/lib/format';
import { Icon, Pill, Spinner, StatTile } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { Section } from '@/components/Section';
import { SideDrawer } from '@/components/SideDrawer';
import { ReportMarkdown } from '@/components/ReportMarkdown';
import { EvidenceIndex } from '@/components/EvidenceIndex';
import { EvidencePanel } from '@/components/EvidencePanel';
import { PriorPanel } from '@/components/PriorPanel';
import { hasPriorStressTest } from '@/lib/intake';

const DELIVERABLE_LABEL: Record<string, string> = {
  peer_review_report: 'Peer review report',
  reviewer_private_notes: "Reviewer's private notes",
  ledger_export: 'Evidence ledger',
  run_archive: 'Review archive',
};

export default function ResultsPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [deliverables, setDeliverables] = useState<DeliverableView[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceData | null>(null);
  const [tab, setTab] = useState<'report' | 'notes'>('report');
  const [drawerFindings, setDrawerFindings] = useState<string[] | null>(null);
  const [runStats, setRunStats] = useState<RunStats | null>(null);

  useEffect(() => {
    const load = async (): Promise<void> => {
      const detail = await api.getReview(id).catch(() => null);
      setReview(detail);
      const stats = await api.getRunStats(id).catch(() => null);
      setRunStats(stats);
      const list = await api.listDeliverables(id).catch(() => ({ deliverables: [] }));
      setDeliverables(list.deliverables);
      const evidenceData = await api.getEvidence(id).catch(() => null);
      setEvidence(evidenceData);
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

  const findingsById = useMemo(() => {
    const map = new Map<string, EvidenceData['findings'][number]>();
    for (const finding of evidence?.findings ?? []) {
      map.set(finding.id, finding);
    }
    return map;
  }, [evidence]);

  const visibleEvidence = useMemo(
    () => (evidence?.evidenceMap ?? []).filter((entry) => (report ?? '').includes(entry.label)),
    [evidence, report],
  );

  const reportReleased = deliverables.some((d) => d.kind === 'peer_review_report' && d.released);

  if (review === null) {
    return <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Spinner /> Loading results</div>;
  }

  const recommendationLabel = review.recommendation !== null
    ? RECOMMENDATION_LABEL[review.recommendation] ?? review.recommendation
    : null;

  const hasEvidence = visibleEvidence.length > 0;
  const prior = evidence?.priorStressTest ?? null;
  const showPrior = hasPriorStressTest(evidence);
  let n = 2;
  const priorNum = showPrior ? (n += 1) : 0;
  const evidenceNum = hasEvidence ? (n += 1) : 0;
  const statsNum = runStats !== null ? (n += 1) : 0;
  const downloadsNum = (n += 1);

  return (
    <div>
      <PageHeader
        eyebrow="Results"
        title={review.title ?? 'Review'}
        sub="Your developmental review, the evidence behind each point, and everything to download."
        actions={
          <a
            className="btn btn-primary"
            href={api.deliverableUrl(id, 'peer_review_report', 'docx')}
            aria-disabled={!reportReleased}
            style={reportReleased ? undefined : { opacity: 0.5, pointerEvents: 'none' }}
          >
            <Icon name="download" /> Download letter (.docx)
          </a>
        }
      />

      {review.status === 'failed' || review.status === 'cancelled' ? (
        <div className="card" style={{ marginBottom: 24, borderLeft: '3px solid var(--psy-lime)' }}>
          <h2 className="h3">Partial results</h2>
          <p className="sub">
            This review did not finish, so the letter was not released. Everything produced before the halt is shown and
            downloadable below, and you can retry the failed phase from the run screen.
          </p>
        </div>
      ) : null}

      <Section number={1} eyebrow="Recommendation" title={recommendationLabel ?? 'Review outcome'}>
        <div className="stack-16">
          {recommendationLabel !== null ? (
            <div className="row wrap">
              <Pill tone="info" label={recommendationLabel} />
            </div>
          ) : null}
          {review.recommendation !== null && RECOMMENDATION_EXPLANATION[review.recommendation] !== undefined ? (
            <p className="sub" style={{ margin: 0 }}>{RECOMMENDATION_EXPLANATION[review.recommendation]}</p>
          ) : null}
          <p className="sub" style={{ margin: 0 }}>{confidenceSentence(review.recommendationConfidence)}</p>
          {review.rubricAverage !== null ? (
            <div className="card-inset row" style={{ gap: 'var(--space-4)', alignItems: 'baseline', width: 'fit-content' }}>
              <span className="mono stat-num" style={{ fontSize: 32 }}>{review.rubricAverage.toFixed(1)}</span>
              <span className="muted">/ 5 rubric average across the fifteen review criteria</span>
            </div>
          ) : null}
        </div>
      </Section>

      <Section number={2} eyebrow="The review" title="Developmental letter">
        <div className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={tab === 'report'} onClick={() => setTab('report')}>
            Letter
          </button>
          <button className="tab" role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')}>
            Reviewer&apos;s private notes
          </button>
        </div>

        {tab === 'report' ? (
          report === null ? (
            reportReleased ? <Spinner /> : <Pill tone="warn" label="The letter has not been released yet." />
          ) : (
            <ReportMarkdown text={report} onFinding={setDrawerFindings} />
          )
        ) : (
          <div className="stack-16">
            <Pill tone="neutral" label="These are editorial signals, not verdicts." icon="shield" />
            {notes === null ? (
              <Pill tone="warn" label="No private notes available." />
            ) : (
              <ReportMarkdown text={notes} onFinding={setDrawerFindings} />
            )}
          </div>
        )}
      </Section>

      {showPrior && prior !== null ? (
        <PriorPanel
          number={priorNum}
          data={prior}
          findingsById={findingsById}
          onFinding={(findingId) => setDrawerFindings([findingId])}
        />
      ) : null}

      {hasEvidence ? (
        <EvidenceIndex
          number={evidenceNum}
          entries={visibleEvidence}
          findingsById={findingsById}
          onFinding={(findingId) => setDrawerFindings([findingId])}
        />
      ) : null}

      {runStats !== null ? (
        <Section number={statsNum} eyebrow="Run" title="This review">
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <StatTile label="Cost" value={formatUsd(runStats.costUsd)} />
            <StatTile label="Tokens in / out" value={`${runStats.tokensIn.toLocaleString()} / ${runStats.tokensOut.toLocaleString()}`} />
            <StatTile label="Tokens cached" value={runStats.tokensCached.toLocaleString()} />
            <StatTile label="Retry rate" value={`${Math.round(runStats.retryRate * 100)}%`} />
            <StatTile label="Time to complete" value={formatDuration(runStats.timeToFirstReviewMs)} />
          </div>
          {Object.keys(runStats.costByPhase).length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 18 }}>
              {Object.entries(runStats.costByPhase).map(([phase, cost]) => (
                <span key={phase} className="pill pill-neutral" style={{ fontSize: 11 }}>
                  {phase} <span className="mono">{formatUsd(cost)}</span>
                </span>
              ))}
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section number={downloadsNum} eyebrow="Downloads" title="Take the review with you">
        <div className="grid-2">
          {deliverables.map((d) => {
            const label = DELIVERABLE_LABEL[d.kind] ?? d.kind;
            return (
              <a
                key={`${d.kind}-${d.format}`}
                className="card-inset spread"
                href={api.deliverableUrl(id, d.kind, d.format)}
                aria-disabled={!d.released}
                style={d.released ? undefined : { opacity: 0.5, pointerEvents: 'none' }}
              >
                <div className="stack-8">
                  <span style={{ fontWeight: 500, color: 'var(--fg-1)' }}>{label}</span>
                  <span className="chip-hint">
                    {d.format.toUpperCase()} · {d.released ? formatBytes(d.byteSize) : 'Pending release'}
                  </span>
                </div>
                <Icon name="download" />
              </a>
            );
          })}
        </div>
      </Section>

      <SideDrawer
        open={drawerFindings !== null}
        title={drawerFindings !== null && drawerFindings.length > 1 ? `Evidence (${drawerFindings.length})` : 'Evidence'}
        onClose={() => setDrawerFindings(null)}
      >
        {drawerFindings !== null ? (
          <div className="stack-24">
            {drawerFindings.map((findingId) => (
              <EvidencePanel
                key={findingId}
                finding={findingsById.get(findingId) ?? null}
                fallbackId={findingId}
                ledgerHref={api.deliverableUrl(id, 'ledger_export', 'md')}
              />
            ))}
          </div>
        ) : null}
      </SideDrawer>
    </div>
  );
}
