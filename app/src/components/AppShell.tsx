'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/', label: 'Library' },
  { href: '/reviews/new', label: 'New review' },
  { href: '/settings', label: 'Settings' },
];

export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const pathname = usePathname();
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="topbar-brand">
          <img src="/brand/psynalytics-logo-white.svg" alt="Psynalytics" />
          <span>MARA</span>
        </Link>
        <nav className="topbar-nav" aria-label="Primary">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="page">
        <div className="container">
          <p className="viewport-notice sub" style={{ marginBottom: 16 }}>
            A wider viewport is recommended for running a review.
          </p>
          {children}
        </div>
      </main>
    </div>
  );
}
