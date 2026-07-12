import type { ReactNode } from 'react';

export default function Page(): ReactNode {
  return (
    <main
      style={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <h1 style={{ fontSize: '3rem', letterSpacing: '0.2em' }}>MARA</h1>
    </main>
  );
}
