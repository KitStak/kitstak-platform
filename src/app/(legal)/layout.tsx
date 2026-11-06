import Link from 'next/link';
import { Logo } from '@/features/shell/logo';

/** Public legal pages (privacy, terms): reachable signed-out, readable long-form layout. */
export default function LegalLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-app">
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-panel/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link
            href="/login"
            aria-label="KitStak home"
            className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          >
            <Logo size={26} />
          </Link>
          <nav aria-label="Legal" className="flex items-center gap-5 text-sm text-fg-secondary">
            <Link className="hover:text-fg" href="/privacy">
              Privacy
            </Link>
            <Link className="hover:text-fg" href="/terms">
              Terms
            </Link>
            <Link className="font-medium text-primary-text hover:underline" href="/login">
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">{children}</main>
    </div>
  );
}
