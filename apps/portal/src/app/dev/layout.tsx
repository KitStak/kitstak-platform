import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FlaskConical } from 'lucide-react';
import { Logo } from '@/features/shell/logo';
import { ThemeToggle } from '@/features/shell/theme-toggle';
import { isProduction } from '@/server/env';

export const metadata: Metadata = { title: 'Email outbox' };
/** Read at request time: the production check must never be baked in at build time. */
export const dynamic = 'force-dynamic';

/**
 * Chrome for the local developer pages. Nothing under /dev exists in production: this layout answers
 * 404 there before any page code runs. The pages sit outside the signed in shell on purpose, so a
 * person who is signed out (waiting for a password reset code) can still read their email.
 */
export default function DevLayout({ children }: { readonly children: React.ReactNode }) {
  if (isProduction()) notFound();
  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <header className="border-b border-border-subtle bg-panel">
        <div className="mx-auto flex h-14 w-full max-w-[1240px] items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href="/"
            aria-label="Back to the Portal"
            className="inline-flex shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          >
            <Logo size={26} />
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <div
        role="status"
        data-testid="test-mode-label"
        className="flex min-h-9 items-center justify-center gap-2 border-b border-warning/25 bg-warning-subtle px-4 py-1.5 text-center text-sm font-semibold text-warning-text"
      >
        <FlaskConical aria-hidden className="size-4 shrink-0" />
        Test mode. These emails were not sent to anyone.
      </div>
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
