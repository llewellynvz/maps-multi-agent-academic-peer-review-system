'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api, type ReviewSummary } from '@/lib/api';
import { formatDate, phaseLabel, RECOMMENDATION_LABEL, statusTone } from '@/lib/format';
import { Icon, Pill, Spinner, StatTile } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { Section } from '@/components/Section';
import { EmptyState } from '@/components/EmptyState';

function isRunning(status: string): boolean {
  return status === 'running' || status === 'sanitizing' || status === 'awaiting_input' || status === 'queued';
}

function reviewHref(review: ReviewSummary): string {
  if (review.status === 'completed') {
    return `/reviews/${review.id}/results`;
  }
  if (review.status === 'awaiting_input') {
    return `/reviews/${review.id}/clarify`;
  }
  return `/reviews/${review.id}/run`;
}

const CARD_STYLE = { display: 'flex', flexDirection: 'column' as const, gap: 14 };

function CardTop({ review }: { review: ReviewSummary }): ReactNode {
  const tone = statusTone(review.status);
  const running = isRunning(review.status);
  const label = running && review.currentPhase !== null ? phaseLabel(review.currentPhase) : tone.label;
  return (
    <div className="spread">
      <span className="row" style={{ gap: 8 }}>
        <Pill tone={tone.tone} label={label} />
        {running ? <span className="timeline-dot node-active" aria-hidden="true" /> : null}
      </span>
      <span className="mono" style={{ color: 'var(--fg-4)', fontSize: 13 }}>{formatDate(review.createdAt)}</span>
    </div>
  );
}

function CardBody({ review }: { review: ReviewSummary }): ReactNode {
  return (
    <>
      <h2 className="h3 clamp-2" style={{ margin: 0 }}>{review.title ?? 'Untitled manuscript'}</h2>
      {review.findingsCount > 0 ? (
        <span className="chip-hint">
          {review.findingsCount} finding{review.findingsCount === 1 ? '' : 's'} recorded
        </span>
      ) : null}
    </>
  );
}

function ReviewCard({ review }: { review: ReviewSummary }): ReactNode {
  if (review.status === 'failed') {
    return (
      <article className="card" style={CARD_STYLE}>
        <CardTop review={review} />
        <CardBody review={review} />
        <div className="row wrap" style={{ marginTop: 'auto', gap: 10 }}>
          <Link href={`/reviews/${review.id}/run`} className="btn btn-secondary">Resume</Link>
          <Link href={`/reviews/${review.id}/results`} className="btn btn-ghost">View partial results</Link>
        </div>
      </article>
    );
  }

  return (
    <Link href={reviewHref(review)} className="card card-hover" style={CARD_STYLE}>
      <CardTop review={review} />
      <CardBody review={review} />
      {review.status === 'completed' ? (
        <div className="spread" style={{ marginTop: 'auto' }}>
          {review.recommendation !== null ? (
            <Pill tone="neutral" label={RECOMMENDATION_LABEL[review.recommendation] ?? review.recommendation} />
          ) : (
            <span />
          )}
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="mono stat-num" style={{ fontSize: 22 }}>
              {review.rubricAverage !== null ? review.rubricAverage.toFixed(1) : '--'}
            </span>
            <span className="muted" style={{ fontSize: 13 }}>/ 5</span>
          </span>
        </div>
      ) : null}
    </Link>
  );
}

export default function LibraryPage(): ReactNode {
  const [reviews, setReviews] = useState<ReviewSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const result = await api.listReviews();
        if (active) {
          setReviews(result.reviews);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Could not load reviews.');
        }
      }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const stats = useMemo(() => {
    if (reviews === null) {
      return null;
    }
    const completed = reviews.filter((review) => review.status === 'completed');
    const rated = completed.filter((review) => review.rubricAverage !== null);
    const average = rated.length > 0
      ? rated.reduce((sum, review) => sum + (review.rubricAverage ?? 0), 0) / rated.length
      : null;
    return {
      total: reviews.length,
      completed: completed.length,
      running: reviews.filter((review) => isRunning(review.status)).length,
      average,
    };
  }, [reviews]);

  const sorted = useMemo(() => {
    if (reviews === null) {
      return null;
    }
    const filtered = reviews.filter((review) => (review.title ?? '').toLowerCase().includes(query.toLowerCase()));
    return [...filtered].sort((a, b) => Number(isRunning(b.status)) - Number(isRunning(a.status)));
  }, [reviews, query]);

  const hasReviews = reviews !== null && reviews.length > 0;

  return (
    <div>
      <PageHeader
        eyebrow="Library"
        title="Your reviews"
        sub="Every manuscript you have put through MARA, with its status, findings, and outcome in one place."
        actions={
          <>
            <div className="field" style={{ margin: 0 }}>
              <label className="sr-only" htmlFor="search">Search reviews</label>
              <input id="search" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} style={{ width: 200 }} />
            </div>
            <Link href="/reviews/new" className="btn btn-primary">
              <Icon name="plus" /> New review
            </Link>
          </>
        }
      />

      {error !== null ? <div style={{ marginBottom: 20 }}><Pill tone="fail" label={error} /></div> : null}

      {reviews === null && error === null ? (
        <div className="row" style={{ color: 'var(--fg-3)' }}>
          <Spinner /> Loading reviews
        </div>
      ) : null}

      {reviews !== null && reviews.length === 0 ? (
        <EmptyState
          icon="upload"
          title="Start your first review"
          steps={[
            'Upload a manuscript as a PDF or DOCX',
            'Confirm the detected scope and focus',
            'Receive a developmental peer review',
          ]}
          cta={<Link href="/reviews/new" className="btn btn-primary"><Icon name="plus" /> New review</Link>}
        />
      ) : null}

      {hasReviews && stats !== null ? (
        <Section number={1} eyebrow="At a glance" title="Your review activity">
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <StatTile label="Total reviews" value={String(stats.total)} />
            <StatTile label="Completed" value={String(stats.completed)} />
            <StatTile label="Running" value={String(stats.running)} />
            <StatTile label="Average rubric" value={stats.average !== null ? `${stats.average.toFixed(1)} / 5` : '--'} />
          </div>
        </Section>
      ) : null}

      {hasReviews && sorted !== null ? (
        <Section number={2} eyebrow="Library" title="All reviews">
          {sorted.length > 0 ? (
            <div className="grid-3" style={{ marginTop: 'var(--space-4)' }}>
              {sorted.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>
          ) : (
            <p className="sub muted" style={{ marginTop: 'var(--space-4)' }}>No reviews match your search.</p>
          )}
        </Section>
      ) : null}
    </div>
  );
}
