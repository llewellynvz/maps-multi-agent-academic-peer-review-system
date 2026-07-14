import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'MARA',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en-GB">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          backgroundColor: '#032A30',
          color: '#F5F1E6',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  );
}
