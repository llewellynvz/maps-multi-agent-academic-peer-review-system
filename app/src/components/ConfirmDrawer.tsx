'use client';

import { type ReactNode, useState } from 'react';
import { Icon } from './ui';
import { SideDrawer } from './SideDrawer';

export function ConfirmDrawer({
  open,
  title,
  warning,
  phrase,
  actionLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  warning: ReactNode;
  phrase: string;
  actionLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}): ReactNode {
  const [typed, setTyped] = useState('');

  const close = (): void => {
    setTyped('');
    onClose();
  };

  return (
    <SideDrawer open={open} title={title} onClose={close}>
      <p className="sub" style={{ marginBottom: 16 }}>
        {warning} Type <span className="mono">{phrase}</span> to confirm.
      </p>
      <div className="field">
        <label>Confirmation</label>
        <input value={typed} onChange={(event) => setTyped(event.target.value)} />
      </div>
      <button
        className="btn btn-danger"
        onClick={() => {
          setTyped('');
          onConfirm();
        }}
        disabled={typed !== phrase}
      >
        <Icon name="trash" /> {actionLabel}
      </button>
    </SideDrawer>
  );
}
