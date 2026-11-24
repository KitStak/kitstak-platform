import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { asc, eq } from 'drizzle-orm';
import { member, organization } from '@kitstak/db/schema';
import { AppSwitcher } from '@kitstak/ui/app-switcher';
import { PlanLockFrame, PlanLockScreen, billingOnlyLock } from '@kitstak/ui/plan-lock';
import { Logo } from '@/features/shell/logo';
import { db } from '@/server/db';
import { appUrls } from '@/server/env';
import { getContext, getSession } from '@/server/session';

export const metadata: Metadata = { title: 'Join an organization' };

/**
 * The organization this person only manages billing for (`core.member.role` is exactly `billing`),
 * or null. The one they last worked in comes first. Such a person has no seat in any app, so they
 * have no workspace here, but they are in an organization and must not be told otherwise.
 */
async function billingOnlyOrg(userId: string, activeOrgId: string | null | undefined): Promise<{ readonly name: string } | null> {
  const rows = await db
    .select({ id: organization.id, name: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name));
  const billing = rows.filter((row) => {
    const parts = row.role.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
    return parts.length > 0 && parts.every((part) => part === 'billing');
  });
  return billing.find((row) => row.id === activeOrgId) ?? billing[0] ?? null;
}

/** Signed in but not a member of any organization yet. */
export default async function NoWorkspacePage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (await getContext()) redirect('/');
  const urls = appUrls();
  const portal = urls.portal;
  // A person who only manages billing: the same lock frame as every app, with a way back to Billing.
  const billingOrg = await billingOnlyOrg(session.user.id, session.session.activeOrganizationId);
  if (billingOrg) {
    return (
      <PlanLockFrame logo={<Logo size={24} />} orgName={billingOrg.name} switcher={<AppSwitcher current="projects" urls={urls} billingOnly />}>
        <PlanLockScreen app="projects" lock={billingOnlyLock(billingOrg.name, portal)} hidePoints />
      </PlanLockFrame>
    );
  }
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-app px-4">
      <div className="w-full max-w-md rounded-2xl border border-border-subtle bg-panel p-8 text-center shadow-sm">
        <div className="flex justify-center">
          <Logo size={26} />
        </div>
        <div className="mx-auto mt-6 flex size-12 items-center justify-center rounded-xl bg-sunken">
          <Building2 aria-hidden className="size-6 text-icon" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-fg">You are not in an organization yet</h1>
        <p className="mt-2 text-base text-fg-secondary">
          Create one in the Portal, or ask a teammate to invite you.
        </p>
        <a
          href={portal}
          className="mt-6 inline-flex h-10 items-center rounded-md bg-primary px-4 text-base font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Go to the Portal
        </a>
      </div>
    </div>
  );
}
