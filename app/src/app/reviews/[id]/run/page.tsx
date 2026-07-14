'use client';

import { useParams, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { PHASE_DESCRIPTIONS, PHASES, phaseIndex, phaseLabel } from '@/lib/format';
import { LENS_FALLBACK, LENS_INFO, prefixOf } from '@/lib/lenses';
import { Icon, Meter, Pill, StatTile } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { LensCard, type LensStatus } from '@/components/LensCard';
import { FindingRow } from '@/components/FindingRow';
import { SeverityLegend } from '@/components/SeverityLegend';
import { ActivityLog, type LogEntry } from '@/components/ActivityLog';

type NodeState = 'pending' | 'active' | 'done' | 'failed' | 'degraded';
const STATE_ICON: Record<NodeState, string> = { pending: 'dot', active: 'dot', done: 'check', failed: 'octagon', degraded: 'triangle' };

interface Finding {
  findingId: string;
  severity: string;
  scope: string;
  lensPrefix: string;
  lensDisplay: string;
  headline: string;
}

function legacyLensPrefix(findingId: string): string {
  const parts = findingId.split('-');
  const candidate = parts.length >= 3 ? parts[1] : prefixOf(findingId);
  return (candidate ?? '').toUpperCase();
}

export default function RunPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [currentPhase, setCurrentPhase] = useState<string>('phase_0');
  const [terminal, setTerminal] = useState<'complete' | 'failed' | null>(null);
  const [failedPhase, setFailedPhase] = useState<string | null>(null);
  const [lenses, setLenses] = useState<Record<string, { status: string; count: number }>>({});
  const [findings, setFindings] = useState<Finding[]>([]);
  const [cost, setCost] = useState<{ total: number; tokensIn: number; tokensOut: number } | null>(null);
  const [eta, setEta] = useState<{ seconds: number; basis: string } | null>(null);
  const [gate, setGate] = useState<{ verdict: string; cycle: number } | null>(null);
  const [logEntries, setLogEntries] = useState<Record<string, { ts: string; message: string; phase: string }>>({});
  const [connected, setConnected] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const notified = useRef(false);
  const phaseRef = useRef('phase_0');

  useEffect(() => {
    phaseRef.current = currentPhase;
  }, [currentPhase]);

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
    const source = new EventSource(`/api/reviews/${id}/events`, { withCredentials: true });
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    const addLog = (key: string, ts: string | undefined, message: string, phase: string): void => {
      setLogEntries((prev) =>
        prev[key] !== undefined ? prev : { ...prev, [key]: { ts: ts ?? new Date().toISOString(), message, phase } },
      );
    };

    source.addEventListener('phase_status', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { phase: string | null; ts?: string };
      if (data.phase !== null) {
        setCurrentPhase((prev) => (phaseIndex(data.phase) >= phaseIndex(prev) ? (data.phase as string) : prev));
        addLog(`phase-${data.phase}`, data.ts, `Started ${phaseLabel(data.phase)}`, data.phase);
      }
    });
    source.addEventListener('lens_status', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { lens: string; status: string; findingsCount: number };
      setLenses((prev) => ({ ...prev, [data.lens]: { status: data.status, count: data.findingsCount } }));
    });
    source.addEventListener('finding_headline', (event) => {
      const raw = JSON.parse((event as MessageEvent).data) as {
        findingId: string;
        severity: string;
        scope: string;
        headline?: string;
        lensPrefix?: string;
        lensDisplay?: string;
      };
      if (raw.severity === 'none') {
        return;
      }
      const lensPrefix = raw.lensPrefix ?? legacyLensPrefix(raw.findingId);
      const info = LENS_INFO[lensPrefix] ?? LENS_FALLBACK;
      const lensDisplay = raw.lensDisplay ?? info.display;
      const headline =
        raw.lensPrefix !== undefined && raw.headline !== undefined
          ? raw.headline
          : raw.scope === 'editor_only'
            ? 'Confidential signal recorded'
            : `${lensDisplay} recorded a ${raw.severity} issue`;
      const finding: Finding = { findingId: raw.findingId, severity: raw.severity, scope: raw.scope, lensPrefix, lensDisplay, headline };
      setFindings((prev) => (prev.some((f) => f.findingId === finding.findingId) ? prev : [finding, ...prev].slice(0, 40)));
    });
    source.addEventListener('cost_tick', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { costUsdTotal: number; tokensIn: number; tokensOut: number };
      setCost({ total: data.costUsdTotal, tokensIn: data.tokensIn, tokensOut: data.tokensOut });
    });
    source.addEventListener('eta_update', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { etaSeconds: number; basis: string };
      setEta({ seconds: data.etaSeconds, basis: data.basis });
    });
    source.addEventListener('gate_verdict', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { verdict: string; cycle: number; source?: string; ts?: string; phase?: string };
      setGate({ verdict: data.verdict, cycle: data.cycle });
      addLog(
        `gate-${data.cycle}-${data.source ?? 'gate'}-${data.verdict}`,
        data.ts,
        `Release gate ${data.verdict}${data.source !== undefined ? ` (${data.source}, cycle ${data.cycle})` : ` (cycle ${data.cycle})`}`,
        data.phase ?? phaseRef.current,
      );
    });
    source.addEventListener('log_event', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { ts: string; message: string };
      addLog(`log-${data.ts}-${data.message.slice(0, 40)}`, data.ts, data.message, phaseRef.current);
    });
    source.addEventListener('dispatch_log', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as {
        dispatches: Array<{ id: string; ts: string; agent: string; phase: string; status: string; latencyMs: number }>;
      };
      for (const dispatch of data.dispatches) {
        addLog(
          `dispatch-${dispatch.id}`,
          dispatch.ts,
          `${dispatch.agent} ${dispatch.status === 'success' ? `finished in ${(dispatch.latencyMs / 1000).toFixed(1)}s` : 'errored'} (${phaseLabel(dispatch.phase)})`,
          dispatch.phase,
        );
      }
    });
    source.addEventListener('run_complete', () => {
      setTerminal('complete');
      source.close();
    });
    source.addEventListener('run_failed', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { phase?: string };
      setTerminal('failed');
      setFailedPhase(data.phase ?? phaseRef.current);
      source.close();
    });

    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const activeIndex = phaseIndex(currentPhase);
  const pct = terminal === 'complete' ? 100 : Math.round((activeIndex / 9) * 100);

  useEffect(() => {
    document.title = terminal === 'complete' ? 'Review complete · MARA' : `${pct}% · ${phaseLabel(currentPhase)} · MARA`;
    return () => {
      document.title = 'MARA';
    };
  }, [pct, currentPhase, terminal]);

  useEffect(() => {
    if (terminal !== null && !notified.current && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      notified.current = true;
      new Notification(terminal === 'complete' ? 'Review complete' : 'Review halted');
    }
    if (terminal === 'complete') {
      const timer = setTimeout(() => router.push(`/reviews/${id}/results`), 1500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [terminal, id, router]);

  function nodeState(phaseKey: string): NodeState {
    const index = phaseIndex(phaseKey);
    if (terminal === 'failed' && phaseKey === failedPhase) {
      return 'failed';
    }
    if (terminal === 'complete') {
      return 'done';
    }
    if (index < activeIndex) {
      return 'done';
    }
    if (index === activeIndex) {
      return 'active';
    }
    return 'pending';
  }

  const lensCards = useMemo(() => {
    const order = Object.keys(LENS_INFO);
    const prefixes = new Set<string>([...Object.keys(lenses), ...findings.map((f) => f.lensPrefix)]);
    return [...prefixes]
      .filter((prefix) => prefix.length > 0)
      .sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
      })
      .map((prefix) => {
        const info = LENS_INFO[prefix] ?? LENS_FALLBACK;
        const reported = lenses[prefix]?.status;
        const count = findings.filter((f) => f.lensPrefix === prefix).length;
        const status: LensStatus =
          reported === 'done' ? 'done' : reported === 'active' || reported === 'running' ? 'running' : count > 0 ? 'running' : 'pending';
        return { prefix, display: info.display, purpose: info.purpose, status, count };
      });
  }, [lenses, findings]);

  const authorFindings = useMemo(() => findings.filter((f) => f.scope !== 'editor_only'), [findings]);
  const editorOnlyCount = findings.filter((f) => f.scope === 'editor_only').length;

  const logList: LogEntry[] = useMemo(
    () =>
      Object.entries(logEntries)
        .map(([key, entry]) => ({ key, ts: entry.ts, message: entry.message, phase: entry.phase }))
        .sort((a, b) => (a.ts < b.ts ? 1 : -1))
        .slice(0, 200),
    [logEntries],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Run progress"
        title={phaseLabel(currentPhase)}
        sub={PHASE_DESCRIPTIONS[currentPhase]}
        actions={
          <>
            {!connected && terminal === null ? <Pill tone="warn" label="Reconnecting" /> : null}
            {gate !== null ? <Pill tone="neutral" label={`Release gate requested revisions, cycle ${gate.cycle} of 2`} icon="clock" /> : null}
            {terminal === 'complete' ? <Pill tone="info" label="Complete" /> : null}
            {terminal === 'failed' ? <Pill tone="fail" label="Halted" /> : null}
          </>
        }
      />

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <StatTile label="Cost" value={cost !== null ? `$${cost.total.toFixed(4)}` : '--'} />
          <StatTile label="Tokens in / out" value={cost !== null ? `${cost.tokensIn} / ${cost.tokensOut}` : '--'} />
          <StatTile label="Estimated remaining" value={eta !== null ? `~${eta.seconds}s` : '--'} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <Meter value={pct / 100} error={terminal === 'failed'} />
          </div>
        </div>
      </div>

      <div className="run-grid">
        <div className="card" aria-label="Pipeline timeline">
          <div className="timeline" role="list">
            {PHASES.map((phase, index) => {
              const state = nodeState(phase.key);
              const description = PHASE_DESCRIPTIONS[phase.key];
              return (
                <div key={phase.key} className={`timeline-node node-${state}`} role="listitem">
                  <div className="timeline-rail">
                    <span className="timeline-dot"><Icon name={STATE_ICON[state]} /></span>
                    {index < PHASES.length - 1 ? <span className="timeline-connector" /> : null}
                  </div>
                  <div className="timeline-body">
                    <span className="timeline-label">{phase.label}</span>
                    {description !== undefined ? (
                      <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-small)', lineHeight: 1.45, color: 'var(--fg-4)' }}>{description}</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2 className="h3">Specialist reviewers</h2>
            <p className="sub" style={{ fontSize: 'var(--fs-small)', marginBottom: 14 }}>
              Each specialist examines the manuscript through one lens. This is what each one checks and what it has found so far.
            </p>
            {lensCards.length === 0 ? (
              <p className="sub muted" style={{ fontSize: 'var(--fs-small)' }}>Reviewers begin once the specialist phase starts.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {lensCards.map((lens) => (
                  <LensCard key={lens.prefix} display={lens.display} purpose={lens.purpose} status={lens.status} count={lens.count} />
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 className="h3">Findings</h2>
            <div className="ticker" aria-live="polite">
              {editorOnlyCount > 0 ? (
                <div className="ticker-row">
                  <Pill tone="neutral" icon="shield" label={`${editorOnlyCount} confidential signal${editorOnlyCount === 1 ? '' : 's'} logged`} />
                </div>
              ) : null}
              {authorFindings.map((finding) => (
                <FindingRow key={finding.findingId} severity={finding.severity} lensDisplay={finding.lensDisplay} headline={finding.headline} />
              ))}
              {findings.length === 0 ? <p className="sub muted" style={{ fontSize: 'var(--fs-small)' }}>No findings recorded yet.</p> : null}
            </div>
            <div style={{ marginTop: 12 }}>
              <SeverityLegend />
            </div>
          </div>

          {terminal === 'failed' ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <h2 className="h3">Recovery</h2>
              <p className="sub" style={{ marginBottom: 12 }}>
                A phase did not complete. Retry re-runs the review from the failed phase (earlier completed work is reused), or you can keep what was produced so far.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {failedPhase !== null ? (
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      void api.retryPhase(id, failedPhase).then(() => window.location.reload());
                    }}
                  >
                    Retry from {phaseLabel(failedPhase)}
                  </button>
                ) : null}
                <button className="btn btn-ghost" onClick={() => router.push(`/reviews/${id}/results`)}>View partial results</button>
              </div>
            </div>
          ) : null}

          {terminal === null ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-ghost" onClick={() => void api.pause(id)}><Icon name="pause" /> Pause</button>
                <button className="btn btn-ghost" onClick={() => void api.resume(id)}><Icon name="play" /> Resume</button>
                <button className="btn btn-ghost" onClick={() => void api.cancel(id)}>Cancel</button>
              </div>
            </div>
          ) : null}

          <div className="card">
            <button className="btn btn-ghost" onClick={() => setLogOpen((open) => !open)} aria-expanded={logOpen}>
              <Icon name="chevron" /> Activity log
            </button>
            {logOpen ? (
              <div style={{ marginTop: 12 }}>
                <ActivityLog entries={logList} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
