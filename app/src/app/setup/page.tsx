'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { api } from '@/lib/api';
import { Icon, Pill, Spinner, Stepper } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';

const STEPS = ['Provider and key', 'Tier preset', 'Defaults', 'Telemetry', 'Review'];

const TIERS = [
  { id: 'fast', name: 'Fast', mix: 'Cheap tier throughout', cost: '$0.10 to $0.40', time: '8 to 15 min' },
  { id: 'balanced', name: 'Balanced', mix: 'Frontier for synthesis', cost: '$0.40 to $1.20', time: '20 to 35 min' },
  { id: 'thorough', name: 'Thorough', mix: 'Frontier and full swarm', cost: '$1.20 to $3.00', time: '60 to 75 min' },
];

type KeyState = 'idle' | 'checking' | 'verified' | 'failed';

export default function SetupPage(): ReactNode {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [keyState, setKeyState] = useState<KeyState>('idle');
  const [keyMessage, setKeyMessage] = useState('');
  const [tier, setTier] = useState('balanced');
  const [telemetry, setTelemetry] = useState(false);
  const [saving, setSaving] = useState(false);

  const verifyKey = async (): Promise<void> => {
    setKeyState('checking');
    try {
      await api.addKey({ provider, apiKey, persist: 'session' });
      setKeyState('verified');
    } catch (err) {
      setKeyState('failed');
      setKeyMessage(err instanceof Error ? err.message : 'The key could not be verified.');
    }
  };

  const saveSetup = async (): Promise<void> => {
    setSaving(true);
    try {
      await api.putSettings({ presetDefault: tier, telemetry });
      router.push('/');
    } catch {
      setSaving(false);
    }
  };

  const canAdvance = step !== 0 || keyState === 'verified' || apiKey.length === 0;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        eyebrow="First run"
        title="Set up MARA"
        sub="Connect a provider, choose a speed and cost tier, and set your defaults. This takes about a minute."
      />
      <div className="card">
        <Stepper steps={STEPS} current={step} />

        {step === 0 ? (
          <div>
            <h2 className="h3">Connect a provider</h2>
            <div className="field">
              <label htmlFor="provider">Provider</label>
              <select id="provider" value={provider} onChange={(event) => { setProvider(event.target.value); setKeyState('idle'); }}>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
                <option value="local">Local</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="key">API key</label>
              <input id="key" type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setKeyState('idle'); }} placeholder="Paste your key" />
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button className="btn btn-secondary" onClick={verifyKey} disabled={apiKey.length === 0 || keyState === 'checking'}>
                {keyState === 'checking' ? <Spinner /> : null} Verify key
              </button>
              {keyState === 'checking' ? <Pill tone="neutral" label="Checking" icon="clock" /> : null}
              {keyState === 'verified' ? <Pill tone="info" label="Verified" icon="check" /> : null}
              {keyState === 'failed' ? <Pill tone="fail" label="Not verified" /> : null}
            </div>
            {keyState === 'failed' ? <p className="sub" style={{ marginTop: 10 }}>{keyMessage}</p> : null}
            {apiKey.length === 0 ? <p className="sub muted" style={{ marginTop: 10 }}>A key is optional here. You can add one later in settings.</p> : null}
          </div>
        ) : null}

        {step === 1 ? (
          <div role="radiogroup" aria-label="Tier preset">
            <h2 className="h3">Choose a speed and cost tier</h2>
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              {TIERS.map((option) => (
                <div key={option.id} className="radio-card" role="radio" aria-checked={tier === option.id} tabIndex={0}
                  onClick={() => setTier(option.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setTier(option.id); }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ color: 'var(--fg-1)' }}>{option.name}</strong>
                    {tier === option.id ? <Icon name="check" className="ico-lime" /> : null}
                  </div>
                  <p className="sub" style={{ margin: '6px 0 10px' }}>{option.mix}</p>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--fg-3)' }}>{option.cost}</span>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--fg-3)' }}>{option.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <h2 className="h3">Defaults</h2>
            <p className="sub">New reviews start at the {TIERS.find((t) => t.id === tier)?.name} tier. You can change this per review at the clarifying step.</p>
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <h2 className="h3">Telemetry</h2>
            <p className="sub" style={{ marginBottom: 16 }}>
              Telemetry sends anonymous run timings and token counts to your own local instance only. It never sends manuscript text, author identities, or model output. It is off by default.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={telemetry} onChange={(event) => setTelemetry(event.target.checked)} />
              <span>Enable telemetry</span>
            </label>
          </div>
        ) : null}

        {step === 4 ? (
          <div>
            <h2 className="h3">Review your setup</h2>
            <div className="table-scroll">
              <table className="table">
                <tbody>
                  <tr><td>Provider</td><td className="num">{provider}</td></tr>
                  <tr><td>Key</td><td className="num">{keyState === 'verified' ? 'verified' : 'not set'}</td></tr>
                  <tr><td>Tier</td><td className="num">{tier}</td></tr>
                  <tr><td>Telemetry</td><td className="num">{telemetry ? 'on' : 'off'}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
          <button className="btn btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</button>
          {step < STEPS.length - 1 ? (
            <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
              Next <Icon name="arrow" />
            </button>
          ) : (
            <button className="btn btn-primary" onClick={saveSetup} disabled={saving}>
              {saving ? <Spinner /> : <Icon name="check" />} Save setup
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
