import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'MARA',
  description: 'Multi-agent academic peer review',
  icons: { icon: '/brand/favicon.svg' },
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en-GB">
      <body>
        <div className="atmo" aria-hidden="true">
          <div className="atmo-mesh" />
          <div className="atmo-grain" />
        </div>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
