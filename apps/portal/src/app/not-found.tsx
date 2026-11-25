import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { LinkButton } from '@/components/ui';
import { Logo } from '@/features/shell/logo';
import { ThemeToggle } from '@/features/shell/theme-toggle';
import { getSession } from '@/server/session';

export const metadata: Metadata = { title: 'Page not found' };

/**
 * Any address the Portal does not know (docs/billing/SPEC.md rule 5: no dead ends).
 *
 * Next shows this file for every URL that matches no route, and for `notFound()` in a segment that
 * has no not-found file of its own. It renders inside the root layout only, so it brings its own
 * small Portal frame: the logo (a way home), the theme switch, one plain sentence and two buttons.
 * A person who is signed in goes back to the apps or to Billing. A person who is not gets "Sign in".
 */
export default async function NotFound() {
  const session = await getSession().catch(() => null);
  const signedIn = session !== null;
  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <header className="border-b border-border-subtle bg-panel">
        <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href="/"
            aria-label="KitStak Portal home"
            className="inline-flex shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus pointer-coarse:min-w-11"
          >
            <Logo size={26} />
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1120px] flex-1 items-start justify-center px-4 py-12 sm:px-6 sm:py-20">
        <section data-testid="not-found" className="flex w-full max-w-[520px] flex-col items-center text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-sunken text-icon">
            <SearchX aria-hidden className="size-6" />
          </span>
          <p className="mt-5 text-xs font-semibold tracking-[0.08em] text-fg-muted uppercase">Error 404</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-fg">We could not find that page.</h1>
          <p className="mt-2 text-md text-fg-secondary">
            The link may be old, or the address may have a typo. Nothing is lost. {signedIn ? 'Your apps and your billing are one click away.' : 'Sign in to get to your apps.'}
          </p>
          <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {signedIn ? (
              <>
                <LinkButton href="/" size="xl" data-testid="not-found-apps">
                  Back to my apps
                </LinkButton>
                <LinkButton href="/billing" variant="secondary" size="xl" data-testid="not-found-billing">
                  Go to Billing
                </LinkButton>
              </>
            ) : (
              <>
                <LinkButton href="/login" size="xl" data-testid="not-found-sign-in">
                  Sign in
                </LinkButton>
                <LinkButton href="/signup" variant="secondary" size="xl" data-testid="not-found-signup">
                  Create an account
                </LinkButton>
              </>
            )}
          </div>
        </section>
      </main>
      <footer className="border-t border-border-subtle">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between px-4 py-4 text-xs text-fg-muted sm:px-6">
          <span>© {new Date().getFullYear()} KitStak</span>
          <span>Portal · CRM · WMS · Projects · Pulse</span>
        </div>
      </footer>
    </div>
  );
}
