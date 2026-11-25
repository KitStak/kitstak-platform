import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { AppSwitcher } from '@kitstak/ui/app-switcher';
import { PlanLockFrame, PlanLockScreen, billingOnlyLock } from '@kitstak/ui/plan-lock';
import { Logo } from '@/features/shell/logo';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { asSystem } from '@/server/db/scope';
import { appUrls } from '@/server/env';
import { getContext, getSession } from '@/server/session';
import { JoinInvitations, type PendingInvitation } from './join-invitations';

export const metadata: Metadata = { title: 'Join an organization' };

/** Invitations sent to this email that can still be accepted. Fails soft: no list, no card. */
async function pendingInvitations(email: string): Promise<PendingInvitation[]> {
  try {
    // A person with no workspace yet: there is no org to scope to, and the tables are in core.
    const result = await asSystem('invitations for a person with no workspace (core tables)', () => db.execute<{ id: string; org_name: string; inviter_name: string | null }>(
      sql`SELECT i.id, o.name AS org_name, u.name AS inviter_name
            FROM core.invitation i
            JOIN core.organization o ON o.id = i.organization_id
            LEFT JOIN core."user" u ON u.id = i.inviter_id
           WHERE lower(i.email) = lower(${email}) AND i.status = 'pending' AND i.expires_at > now()
           ORDER BY i.expires_at DESC LIMIT 5`,
    ));
    return result.rows.map((row) => ({ id: row.id, orgName: row.org_name, inviterName: row.inviter_name }));
  } catch {
    return [];
  }
}

/**
 * The organization this person only manages billing for (`core.member.role` is exactly `billing`),
 * or null. The one they last worked in comes first. Such a person has no seat in any app, so they
 * have no workspace here, but they are in an organization and must not be told otherwise.
 */
async function billingOnlyOrg(userId: string, activeOrgId: string | null | undefined): Promise<{ readonly name: string } | null> {
  try {
    const result = await asSystem('a person with no workspace: their billing only membership (core tables)', () => db.execute<{ id: string; name: string; role: string }>(
      sql`SELECT o.id, o.name, m.role
            FROM core.member m
            JOIN core.organization o ON o.id = m.organization_id
           WHERE m.user_id = ${userId}
           ORDER BY o.name`,
    ));
    const billing = result.rows.filter((row) => {
      const parts = row.role.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
      return parts.length > 0 && parts.every((part) => part === 'billing');
    });
    return billing.find((row) => row.id === activeOrgId) ?? billing[0] ?? null;
  } catch {
    return null;
  }
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
      <PlanLockFrame logo={<Logo size={24} />} orgName={billingOrg.name} switcher={<AppSwitcher current="pulse" urls={urls} billingOnly />}>
        <PlanLockScreen app="pulse" lock={billingOnlyLock(billingOrg.name, portal)} hidePoints />
      </PlanLockFrame>
    );
  }
  const invitations = await pendingInvitations(session.user.email);
  if (invitations.length > 0) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-app px-4">
        <div className="w-full max-w-md rounded-2xl border border-border-subtle bg-panel p-8 text-center shadow-sm">
          <div className="flex justify-center">
            <Logo size={26} />
          </div>
          <div className="mx-auto mt-6 flex size-12 items-center justify-center rounded-xl bg-sunken">
            <Building2 aria-hidden className="size-6 text-icon" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-fg">You have an invitation</h1>
          <p className="mt-2 text-base text-fg-secondary">Join the organization to open its KitStak apps. An admin there decides what you can see.</p>
          <JoinInvitations invitations={invitations} />
        </div>
      </div>
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
