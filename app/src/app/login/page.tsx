'use client';

import { type ReactNode, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon, Pill, Spinner } from '@/components/ui';

function LoginForm(): ReactNode {
  const params = useSearchParams();
  const from = params.get('from') ?? '/';
  const [passphrase, setPassphrase] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setState('checking');
    try {
      await api.login(passphrase);
      window.location.href = from;
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'The passphrase does not match.');
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '40px auto' }}>
      <div className="card">
        <p className="eyebrow">Instance passphrase</p>
        <h1 className="h1">Unlock this instance</h1>
        <p className="sub" style={{ marginBottom: 20 }}>This instance is protected by a passphrase. Enter it to continue.</p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="pass">Passphrase</label>
            <input id="pass" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoFocus />
          </div>
          {state === 'error' ? <div style={{ marginBottom: 12 }}><Pill tone="fail" label={message} /></div> : null}
          <button className="btn btn-primary" type="submit" disabled={state === 'checking' || passphrase.length === 0}>
            {state === 'checking' ? <Spinner /> : <Icon name="shield" />} Continue
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage(): ReactNode {
  return (
    <Suspense fallback={<Spinner />}>
      <LoginForm />
    </Suspense>
  );
}
