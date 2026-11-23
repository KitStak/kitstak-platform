import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PlanLockScreen } from '@kitstak/ui/plan-lock';
import { Logo } from '@/features/shell/logo';
import { findOrgMembership, getSession } from '@/server/auth/session';
import { getPlanView } from '@/server/plan';
import { LockedSwitcher } from './locked-switcher';

export const metadata: Metadata = { title: 'CRM is not in your plan' };

interface LockedPageProps {
  readonly params: Promise<{ orgSlug: string }>;
}

/**
 * The CRM lock screen (docs/billing/SPEC.md section 9.3): `getPageOrgMembership` sends members of
 * an org whose plan does not include the CRM here. It lives in its own route group, NOT under
 * (app)/[orgSlug], so the gated layout never wraps it (no redirect loop). The words, the price and
 * both links come from `planLockFor` in `@kitstak/billing`, the same in every KitStak app.
 */
export default async function LockedPage({ params }: LockedPageProps) {
  const { orgSlug } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/${orgSlug}`)}`);
  const membership = await findOrgMembership(session.user.id, orgSlug);
  if (!membership) notFound(); // signed in but not a member: do not reveal whether the org exists

  const plan = await getPlanView({
    orgId: membership.organization.id,
    userId: session.user.id,
    role: membership.roleString,
  });
  // The CRM is in the plan (again): nothing to lock, back into the app.
  if (!plan.lock) redirect(`/${membership.organization.slug}`);

  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-panel px-4 sm:px-6">
        <Link
          href="/"
          aria-label="KitStak CRM home"
          className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Logo size={26} />
        </Link>
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden truncate text-sm text-fg-secondary sm:block">{membership.organization.name}</span>
          <LockedSwitcher badges={plan.badges} />
        </div>
      </header>
      <main id="main-content" className="flex flex-1 flex-col">
        <PlanLockScreen app="crm" lock={plan.lock} />
      </main>
    </div>
  );
}
