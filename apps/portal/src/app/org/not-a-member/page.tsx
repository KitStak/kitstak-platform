import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { LinkButton } from '@/components/ui';
import { Logo } from '@/features/shell/logo';
import { ThemeToggle } from '@/features/shell/theme-toggle';
import { getSession } from '@/server/session';

export const metadata: Metadata = { title: 'Not your organization' };

/**
 * Shown when a link names an organization the signed in person is not in (review round 4,
 * `@/lib/org-link`). One plain sentence and a way on, never another organization's page. It names
 * no organization: a person who is not a member is told nothing about it.
 */
export default async function NotAMemberPage() {
  const session = await getSession().catch(() => null);
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
        <section data-testid="org-not-a-member" className="flex w-full max-w-[520px] flex-col items-center text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-sunken text-icon">
            <Building2 aria-hidden className="size-6" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-[-0.02em] text-fg">This link is for another organization.</h1>
          <p className="mt-2 text-md text-fg-secondary" data-testid="org-not-a-member-text">
            {session
              ? `You are signed in as ${session.user.email}, and that account is not in the organization this link is for. Sign in with the account that got the email, or ask the owner to invite you.`
              : 'Sign in with the account that got the email, or ask the owner to invite you.'}
          </p>
          <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <LinkButton href="/" size="xl" data-testid="org-not-a-member-home">
              Go to my Portal
            </LinkButton>
          </div>
        </section>
      </main>
    </div>
  );
}
