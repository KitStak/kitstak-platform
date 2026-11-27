import type { Metadata } from 'next';
import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import { Logo } from '@/features/shell/logo';
import { ThemeToggle } from '@/features/shell/theme-toggle';

export const metadata: Metadata = { title: 'Test checkout' };

/**
 * Chrome for the two test gateway pages. They sit outside the signed in shell, the way a hosted pay
 * page does, and always say "Test mode". Each page checks the session and the mode itself.
 */
export default function TestGatewayLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <header className="border-b border-border-subtle bg-panel">
        <div className="mx-auto flex h-14 w-full max-w-[960px] items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/billing" aria-label="Back to Billing" className="inline-flex shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
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
        Test mode. No real money moves.
      </div>
      <main className="mx-auto w-full max-w-[960px] flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
