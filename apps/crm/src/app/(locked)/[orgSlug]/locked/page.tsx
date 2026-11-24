import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PlanLockFrame, PlanLockScreen } from '@kitstak/ui/plan-lock';
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

  // The same frame as the WMS, Projects and Pulse lock screens (`PlanLockFrame`).
  return (
    <PlanLockFrame
      logo={
        <Link href="/" aria-label="KitStak CRM home">
          <Logo size={24} />
        </Link>
      }
      orgName={membership.organization.name}
      switcher={<LockedSwitcher badges={plan.badges} />}
    >
      <PlanLockScreen app="crm" lock={plan.lock} />
    </PlanLockFrame>
  );
}
