'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api, type ReviewSummary } from '@/lib/api';
import { formatDate, phaseLabel, RECOMMENDATION_LABEL, statusTone } from '@/lib/format';
import { Icon, Pill, Spinner } from '@/components/ui';

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

function ReviewCard({ review }: { review: ReviewSummary }): ReactNode {
  const tone = statusTone(review.status);
  const running = isRunning(review.status);
  return (
    <Link href={reviewHref(review)} className="card card-hover" style={{ display: 'block' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <h2 className="h3" style={{ margin: 0 }}>
          {review.title ?? 'Untitled manuscript'}
        </h2>
        {running ? <span className="timeline-dot node-active" aria-hidden="true" /> : null}
      </div>
      <p className="mono" style={{ color: 'var(--fg-4)', fontSize: 13, margin: '6px 0 16px' }}>{formatDate(review.createdAt)}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Pill tone={tone.tone} label={running && review.currentPhase !== null ? phaseLabel(review.currentPhase) : tone.label} />
        {review.recommendation !== null ? (
          <Pill tone="neutral" label={RECOMMENDATION_LABEL[review.recommendation] ?? review.recommendation} />
        ) : null}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="mono stat-num" style={{ fontSize: 22 }}>
            {review.rubricAverage !== null ? review.rubricAverage.toFixed(1) : '--'}
          </span>
          <span className="muted" style={{ fontSize: 13 }}>/ 5</span>
        </span>
      </div>
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

  const sorted = useMemo(() => {
    if (reviews === null) {
      return null;
    }
    const filtered = reviews.filter((review) => (review.title ?? '').toLowerCase().includes(query.toLowerCase()));
    return [...filtered].sort((a, b) => Number(isRunning(b.status)) - Number(isRunning(a.status)));
  }, [reviews, query]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <div>
          <p className="eyebrow">Library</p>
          <h1 className="h1">Your reviews</h1>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="sr-only" htmlFor="search">Search reviews</label>
            <input id="search" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} style={{ width: 180 }} />
          </div>
          <Link href="/reviews/new" className="btn btn-primary">
            <Icon name="plus" /> New review
          </Link>
        </div>
      </div>

      {error !== null ? <Pill tone="fail" label={error} /> : null}

      {sorted === null && error === null ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--fg-3)' }}>
          <Spinner /> Loading reviews
        </div>
      ) : null}

      {sorted !== null && sorted.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 56 }}>
          <h2 className="h2">No reviews yet</h2>
          <p className="sub" style={{ margin: '8px auto 20px' }}>Bring a manuscript in to produce a developmental peer review.</p>
          <Link href="/reviews/new" className="btn btn-primary">Start your first review</Link>
        </div>
      ) : null}

      {sorted !== null && sorted.length > 0 ? (
        <div className="grid-3">
          {sorted.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
