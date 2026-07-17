'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { api, type ProviderKeyView, type PublicSettings, type ReviewSummary } from '@/lib/api';
import { Icon, Pill, Spinner } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmDrawer } from '@/components/ConfirmDrawer';

export default function SettingsPage(): ReactNode {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [keys, setKeys] = useState<ProviderKeyView[]>([]);
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [newProvider, setNewProvider] = useState('anthropic');
  const [newKey, setNewKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [dangerReview, setDangerReview] = useState<ReviewSummary | null>(null);
  const [dangerAll, setDangerAll] = useState(false);

  const load = async (): Promise<void> => {
    setSettings(await api.getSettings().catch(() => null));
    setKeys((await api.listKeys().catch(() => ({ keys: [] }))).keys);
    setReviews((await api.listReviews().catch(() => ({ reviews: [] }))).reviews);
  };

  useEffect(() => { void load(); }, []);

  const flash = (message: string): void => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const addKey = async (): Promise<void> => {
    try {
      await api.addKey({ provider: newProvider, apiKey: newKey, persist: 'disk' });
      setNewKey('');
      flash('Key added');
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not add the key');
    }
  };

  const savePassphrase = async (clear: boolean): Promise<void> => {
    await api.putSettings({ passphrase: clear ? null : passphrase }).catch(() => null);
    setPassphrase('');
    flash(clear ? 'Passphrase cleared' : 'Passphrase set');
    await load();
  };

  const toggleTelemetry = async (value: boolean): Promise<void> => {
    setSettings(await api.putSettings({ telemetry: value }).catch(() => settings));
  };

  const purge = async (): Promise<void> => {
    if (dangerReview === null) {
      return;
    }
    await api.deleteReview(dangerReview.id).catch(() => null);
    setDangerReview(null);
    flash('Review deleted');
    await load();
  };

  const purgeEverything = async (): Promise<void> => {
    try {
      const result = await api.deleteAllReviews();
      setDangerAll(false);
      flash(`Deleted ${result.purged} review${result.purged === 1 ? '' : 's'}`);
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not delete all reviews');
    }
    await load();
  };

  if (settings === null) {
    return <div style={{ display: 'flex', gap: 10 }}><Spinner /> Loading settings</div>;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Manage your instance"
        sub="Providers, the instance passphrase, telemetry, and the reviews stored on disk."
      />

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 className="h3">Providers and keys</h2>
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Provider</th><th>Key</th><th>Persist</th><th></th></tr></thead>
            <tbody>
              {keys.length === 0 ? <tr><td colSpan={4} className="muted">No providers configured.</td></tr> : null}
              {keys.map((key) => (
                <tr key={key.id}>
                  <td>{key.provider}</td>
                  <td className="num">{key.maskedKey}</td>
                  <td><Pill tone="info" label="Verified" /></td>
                  <td className="num"><button className="btn btn-ghost" onClick={() => api.deleteKey(key.id).then(load)} aria-label="Delete key"><Icon name="trash" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Provider</label>
            <select value={newProvider} onChange={(event) => setNewProvider(event.target.value)}>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="google">Google</option>
              <option value="local">Local</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 200 }}>
            <label>API key</label>
            <input type="password" value={newKey} onChange={(event) => setNewKey(event.target.value)} />
          </div>
          <button className="btn btn-secondary" onClick={addKey} disabled={newKey.length === 0}><Icon name="plus" /> Add</button>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <h2 className="h3">Instance passphrase</h2>
          <p className="sub" style={{ marginBottom: 12 }}>When set, every screen requires this passphrase. It is stored only as a salted hash.</p>
          <Pill tone={settings.passphraseSet ? 'info' : 'neutral'} label={settings.passphraseSet ? 'Passphrase set' : 'Open instance'} />
          <div className="field" style={{ marginTop: 16 }}>
            <label>New passphrase</label>
            <input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => savePassphrase(false)} disabled={passphrase.length === 0}>Set</button>
            {settings.passphraseSet ? <button className="btn btn-ghost" onClick={() => savePassphrase(true)}>Clear</button> : null}
          </div>
        </div>

        <div className="card">
          <h2 className="h3">Telemetry and defaults</h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16 }}>
            <input type="checkbox" checked={settings.telemetry} onChange={(event) => toggleTelemetry(event.target.checked)} />
            <span>Telemetry (anonymous run timings to your local instance only)</span>
          </label>
          <div className="table-scroll">
            <table className="table">
              <tbody>
                <tr><td>Default tier</td><td className="num">{settings.presetDefault}</td></tr>
                <tr><td>Data location</td><td className="num" style={{ wordBreak: 'break-all' }}>{settings.dataLocation}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ borderColor: 'rgba(224,117,103,0.3)' }}>
        <h2 className="h3">Danger zone</h2>
        <p className="sub" style={{ marginBottom: 12 }}>Deleting a review removes its manuscript, findings, and deliverables from disk. This cannot be undone.</p>
        <div className="table-scroll">
          <table className="table">
            <tbody>
              {reviews.map((review) => (
                <tr key={review.id}>
                  <td>{review.title ?? 'Untitled'}</td>
                  <td className="num">{review.status}</td>
                  <td className="num"><button className="btn btn-danger" onClick={() => setDangerReview(review)}>Delete</button></td>
                </tr>
              ))}
              {reviews.length === 0 ? <tr><td colSpan={3} className="muted">No reviews stored.</td></tr> : null}
            </tbody>
          </table>
        </div>
        {reviews.length > 0 ? (
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-danger" onClick={() => setDangerAll(true)}>
              <Icon name="trash" /> Delete all reviews
            </button>
          </div>
        ) : null}
      </div>

      <ConfirmDrawer
        open={dangerReview !== null}
        title="Confirm deletion"
        warning={<>This permanently removes <strong>{dangerReview?.title ?? 'this review'}</strong> and every artefact on disk.</>}
        phrase="delete"
        actionLabel="Delete review"
        onConfirm={() => void purge()}
        onClose={() => setDangerReview(null)}
      />

      <ConfirmDrawer
        open={dangerAll}
        title="Delete every review"
        warning={<>This permanently removes <strong>all {reviews.length} review{reviews.length === 1 ? '' : 's'}</strong>, every manuscript, finding, and deliverable on disk. Cached citation lookups are kept. This cannot be undone.</>}
        phrase="delete everything"
        actionLabel="Delete all reviews"
        onConfirm={() => void purgeEverything()}
        onClose={() => setDangerAll(false)}
      />

      {toast !== null ? <div className="toast-wrap"><div className="toast toast-info"><Icon name="check" /> {toast}</div></div> : null}
    </div>
  );
}
