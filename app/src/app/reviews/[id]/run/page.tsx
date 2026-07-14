'use client';

import { useParams, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { PHASES, phaseIndex, phaseLabel } from '@/lib/format';
import { Icon, Meter, Pill } from '@/components/ui';

type NodeState = 'pending' | 'active' | 'done' | 'failed' | 'degraded';
const STATE_ICON: Record<NodeState, string> = { pending: 'dot', active: 'dot', done: 'check', failed: 'octagon', degraded: 'triangle' };

interface Finding {
  findingId: string;
  severity: string;
  scope: string;
  headline: string;
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
  const [logs, setLogs] = useState<Array<{ ts: string; message: string }>>([]);
  const [connected, setConnected] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const notified = useRef(false);

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
    const source = new EventSource(`/api/reviews/${id}/events`, { withCredentials: true });
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.addEventListener('phase_status', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { phase: string | null };
      if (data.phase !== null) {
        setCurrentPhase((prev) => (phaseIndex(data.phase) >= phaseIndex(prev) ? (data.phase as string) : prev));
      }
    });
    source.addEventListener('lens_status', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { lens: string; status: string; findingsCount: number };
      setLenses((prev) => ({ ...prev, [data.lens]: { status: data.status, count: data.findingsCount } }));
    });
    source.addEventListener('finding_headline', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as Finding;
      setFindings((prev) => (prev.some((f) => f.findingId === data.findingId) ? prev : [data, ...prev].slice(0, 40)));
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
      const data = JSON.parse((event as MessageEvent).data) as { verdict: string; cycle: number };
      setGate({ verdict: data.verdict, cycle: data.cycle });
    });
    source.addEventListener('log_event', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { ts: string; message: string };
      setLogs((prev) => [...prev.slice(-80), data]);
    });
    source.addEventListener('run_complete', () => {
      setTerminal('complete');
      source.close();
    });
    source.addEventListener('run_failed', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { phase?: string };
      setTerminal('failed');
      setFailedPhase(data.phase ?? currentPhase);
      source.close();
    });

    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const activeIndex = phaseIndex(currentPhase);
  const pct = terminal === 'complete' ? 100 : Math.round((activeIndex / 9) * 100);

  useEffect(() => {
    document.title = terminal === 'complete' ? 'Review complete · MARA' : `${pct}% · ${phaseLabel(currentPhase)} · MARA`;
    return () => { document.title = 'MARA'; };
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

  const lensList = useMemo(() => Object.entries(lenses), [lenses]);
  const editorOnlyCount = findings.filter((finding) => finding.scope === 'editor_only').length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <p className="eyebrow">Run progress</p>
          <h1 className="h1">{phaseLabel(currentPhase)}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!connected && terminal === null ? <Pill tone="warn" label="Reconnecting" /> : null}
          {gate !== null ? <Pill tone="neutral" label={`Release gate requested revisions, cycle ${gate.cycle} of 2`} icon="clock" /> : null}
          {terminal === 'complete' ? <Pill tone="info" label="Complete" /> : null}
          {terminal === 'failed' ? <Pill tone="fail" label="Halted" /> : null}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <p className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Cost</p>
            <span className="mono stat-num" style={{ fontSize: 20 }}>{cost !== null ? `$${cost.total.toFixed(4)}` : '--'}</span>
          </div>
          <div>
            <p className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Tokens in / out</p>
            <span className="mono stat-num" style={{ fontSize: 20 }}>{cost !== null ? `${cost.tokensIn} / ${cost.tokensOut}` : '--'}</span>
          </div>
          <div>
            <p className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Estimated remaining</p>
            <span className="mono stat-num" style={{ fontSize: 20 }}>{eta !== null ? `~${eta.seconds}s` : '--'}</span>
          </div>
          <div style={{ flex: 1, minWidth: 180, alignSelf: 'center' }}>
            <Meter value={pct / 100} error={terminal === 'failed'} />
          </div>
        </div>
      </div>

      <div className="run-grid">
        <div className="card" aria-label="Pipeline timeline">
          <div className="timeline" role="list">
            {PHASES.map((phase, index) => {
              const state = nodeState(phase.key);
              return (
                <div key={phase.key} className={`timeline-node node-${state}`} role="listitem">
                  <div className="timeline-rail">
                    <span className="timeline-dot"><Icon name={STATE_ICON[state]} /></span>
                    {index < PHASES.length - 1 ? <span className="timeline-connector" /> : null}
                  </div>
                  <div className="timeline-body">
                    <span className="timeline-label">{phase.label}</span>
                    {state === 'active' && phase.key === 'phase_3' && lensList.length > 0 ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        {lensList.map(([lens, info]) => (
                          <span key={lens} className="pill pill-neutral" style={{ fontSize: 11 }}>
                            {lens} <span className="mono">{info.count}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2 className="h3">Findings</h2>
            <div className="ticker" aria-live="polite">
              {editorOnlyCount > 0 ? (
                <div className="ticker-row"><Pill tone="neutral" label={`${editorOnlyCount} confidential signal${editorOnlyCount === 1 ? '' : 's'} logged`} icon="shield" /></div>
              ) : null}
              {findings.filter((finding) => finding.scope !== 'editor_only').map((finding) => (
                <div key={finding.findingId} className="ticker-row">
                  <span className="mono" style={{ fontSize: 12, color: 'var(--psy-teal-light)' }}>{finding.findingId}</span>
                  <span style={{ flex: 1 }}>{finding.headline}</span>
                  <Pill tone={finding.severity === 'fatal' || finding.severity === 'major' ? 'fail' : finding.severity === 'moderate' ? 'warn' : 'neutral'} label={finding.severity} />
                </div>
              ))}
              {findings.length === 0 ? <p className="sub muted">No findings recorded yet.</p> : null}
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
              <div className="logstream" style={{ marginTop: 12 }} role="log">
                {logs.length === 0 ? <span className="muted">No activity yet.</span> : null}
                {logs.map((entry, index) => (
                  <div key={index}><span className="ts">{entry.ts.slice(11, 19)}</span><span className="msg">{entry.message}</span></div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
