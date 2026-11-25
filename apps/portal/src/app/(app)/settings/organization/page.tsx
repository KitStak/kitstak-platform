import type { Metadata } from 'next';
import { and, asc, eq } from 'drizzle-orm';
import { invitation, member, organization, user } from '@kitstak/db/schema';
import { db } from '@/server/db';
import { requirePageSession } from '@/server/session';
import { listUserOrgs, resolveActiveOrg } from '@/server/orgs';
import { getBillingContext } from '@/server/billing/context';
import { getOrgPlan } from '@/server/entitlements';
import { env } from '@/server/env';
import { CATALOG, seatLimitFor } from '@kitstak/billing/catalog';
import { usesSeats } from '@/features/billing/format';
import { InviteMemberForm } from './invite-member-form';
import { InvitationRow, MemberRemovedNotice, MemberRow } from './member-rows';
import { LeaveOrgButton } from './leave-org-card';
import { OrgProfileForm } from './org-profile-form';
import { SetupGuide } from '@/features/setup/setup-guide';
import { getSetupState } from '@/server/onboarding';

export const metadata: Metadata = { title: 'Organization' };

const MANAGER_ROLES = new Set(['owner', 'admin']);

const inviteDateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const createdDateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

interface InvitationView {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly expired: boolean;
  readonly expiresLabel: string;
}

/** Request-time view of a pending invitation (dates resolved server-side, outside render purity rules). */
function toInvitationView(row: {
  readonly id: string;
  readonly email: string;
  readonly role: string | null;
  readonly expiresAt: Date;
}): InvitationView {
  return {
    id: row.id,
    email: row.email,
    role: row.role ?? 'member',
    expired: row.expiresAt.getTime() < Date.now(),
    expiresLabel: inviteDateFormat.format(row.expiresAt),
  };
}

/** Org profile + members + invitations, over the Better Auth organization endpoints. */
export default async function OrganizationSettingsPage() {
  const session = await requirePageSession('/settings/organization');
  const orgs = await listUserOrgs(session.user.id);
  const activeOrg = await resolveActiveOrg(session, orgs);

  if (!activeOrg) {
    return (
      <section className="py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">Organization</h1>
        <p className="mt-2 text-md text-fg-secondary">
          Join or create an organization from the launcher first.
        </p>
      </section>
    );
  }

  const canManage = MANAGER_ROLES.has(activeOrg.role);

  const members = await db
    .select({
      memberId: member.id,
      role: member.role,
      userId: user.id,
      name: user.name,
      email: user.email,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, activeOrg.id))
    .orderBy(asc(user.name));

  const invitationRows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .where(and(eq(invitation.organizationId, activeOrg.id), eq(invitation.status, 'pending')))
    .orderBy(asc(invitation.email));
  const invitations = invitationRows.map(toInvitationView);

  // Non-admins get a named contact instead of a silently missing invite form.
  const orgAdminName =
    members.find(
      (row) => row.userId !== session.user.id && MANAGER_ROLES.has(row.role.split(',')[0]?.trim() ?? ''),
    )?.name ?? null;

  // Seat facts for the invite form (docs/billing/SPEC.md 6.9). Limits apply on paid plans only.
  const [billing, plan] = await Promise.all([getBillingContext(), getOrgPlan(activeOrg.id)]);
  // A person who only manages billing sets up no app: no guide for them (review round 3).
  const billingOnly = activeOrg.role === 'billing';
  const setup = billingOnly
    ? null
    : await getSetupState(activeOrg, { timeZone: billing?.timeZone, canManageBilling: billing?.access.canManage ?? false, canManageOrg: canManage });
  // Seats in use: people whose role uses a seat, and open invites with such a role (the same count
  // the server uses when it decides whether an invite may go out). Guests and people who only
  // manage billing are free.
  const freeRoles: readonly string[] = CATALOG.freeRoles;
  const usesSeat = (role: string | null): boolean => {
    const parts = (role ?? 'member').split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
    if (parts.some((part) => part.startsWith('deactivated:'))) return false;
    return parts.length === 0 || !parts.every((part) => freeRoles.includes(part));
  };
  const seatsUsed = members.filter((row) => usesSeat(row.role)).length + invitations.filter((invite) => !invite.expired && usesSeat(invite.role)).length;
  const inviteSeats = {
    canManageBilling: billing?.access.canManage ?? false,
    paidSelection: plan.state.hasSubscription && usesSeats(plan.state.selection) ? plan.state.selection : null,
    paid: plan.state.hasSubscription,
    limit: plan.state.hasSubscription ? seatLimitFor(plan.state.selection) : null,
    used: seatsUsed,
    ownerName: billing?.access.ownerName ?? null,
    siteUrl: env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, ''),
  };

  // What removing a person does to the bill, said in the confirm (review round 3). Removing never
  // lowers the bill by itself: the paid seats stay until someone lowers them on the plan page.
  const paidSeats = inviteSeats.limit;
  const seatNoteFor = (role: string): string | null => {
    if (paidSeats === null || !usesSeat(role)) return null;
    return paidSeats === 1 ? 'You still pay for 1 seat.' : `You still pay for ${paidSeats} seats until you lower them.`;
  };

  const [orgRow] = await db
    .select({ createdAt: organization.createdAt })
    .from(organization)
    .where(eq(organization.id, activeOrg.id));
  const ownersCount = members.filter((row) => (row.role.split(',')[0]?.trim() ?? '') === 'owner').length;
  const isSoleOwner = activeOrg.role === 'owner' && ownersCount <= 1;

  return (
    <div className="mx-auto grid w-full max-w-[1020px] gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <header className="lg:col-span-2">
        <p className="text-sm font-medium text-fg-muted">{activeOrg.name}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-fg">Organization</h1>
      </header>

      <div className="flex min-w-0 flex-col gap-8">
        <section
          aria-labelledby="org-profile-heading"
          className="rounded-xl border border-border-default bg-panel p-6 shadow-xs"
        >
          <h2 id="org-profile-heading" className="text-base font-semibold text-fg">
            Profile
          </h2>
          <div className="mt-5">
            <OrgProfileForm
              orgId={activeOrg.id}
              name={activeOrg.name}
              slug={activeOrg.slug}
              canManage={canManage}
            />
          </div>
        </section>

        {setup && setup.quick.steps.length > 0 ? (
          <div id="setup" className="scroll-mt-24">
            <SetupGuide orgName={activeOrg.name} state={setup} canManage={canManage} />
          </div>
        ) : null}

        <section
          aria-labelledby="org-members-heading"
          className="rounded-xl border border-border-default bg-panel shadow-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-6 py-5">
            <div>
              <h2 id="org-members-heading" className="text-base font-semibold text-fg">
                Members
              </h2>
              <p className="mt-0.5 text-sm text-fg-muted">
                {members.length} {members.length === 1 ? 'person' : 'people'} in {activeOrg.name}
              </p>
            </div>
          </div>
          <MemberRemovedNotice />
          <ul className="divide-y divide-border-subtle">
            {members.map((row) => (
              <MemberRow
                key={row.memberId}
                memberId={row.memberId}
                orgId={activeOrg.id}
                name={row.name}
                email={row.email}
                // A person who only manages billing is added and removed on the Billing team page.
                role={row.role.trim() === 'billing' ? 'Billing only' : row.role}
                isSelf={row.userId === session.user.id}
                canManage={canManage && row.role.trim() !== 'billing'}
                seatNote={seatNoteFor(row.role)}
              />
            ))}
          </ul>
          {canManage ? (
            <div className="border-t border-border-subtle px-6 py-5">
              <h3 className="text-sm font-semibold text-fg">Invite someone</h3>
              <div className="mt-3">
                <InviteMemberForm
                  orgId={activeOrg.id}
                  emailVerified={session.user.emailVerified === true}
                  seats={inviteSeats}
                  team={members.map((row) => ({ email: row.email, name: row.name }))}
                />
              </div>
            </div>
          ) : (
            <div className="border-t border-border-subtle px-6 py-4">
              <p className="text-sm text-fg-secondary">
                Only owners and admins can invite members or change roles.
                {orgAdminName ? (
                  <>
                    {' '}
                    Ask <span className="font-semibold text-fg">{orgAdminName}</span>.
                  </>
                ) : null}
              </p>
            </div>
          )}
        </section>

        {invitations.length > 0 ? (
          <section
            aria-labelledby="org-invites-heading"
            className="rounded-xl border border-border-default bg-panel shadow-xs"
          >
            <div className="border-b border-border-subtle px-6 py-5">
              <h2 id="org-invites-heading" className="text-base font-semibold text-fg">
                Pending invitations
              </h2>
            </div>
            <ul className="divide-y divide-border-subtle">
              {invitations.map((invite) => (
                <InvitationRow
                  key={invite.id}
                  invitationId={invite.id}
                  email={invite.email}
                  role={invite.role}
                  expired={invite.expired}
                  expiresLabel={invite.expiresLabel}
                  canManage={canManage}
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <aside className="flex min-w-0 flex-col gap-8">
        <section
          aria-labelledby="org-about-heading"
          className="rounded-xl border border-border-default bg-panel p-6 shadow-xs"
        >
          <h2 id="org-about-heading" className="text-base font-semibold text-fg">
            About
          </h2>
          <dl className="mt-4 flex flex-col gap-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-fg-muted">Created</dt>
              <dd className="font-medium text-fg">
                {orgRow?.createdAt ? createdDateFormat.format(orgRow.createdAt) : 'Unknown'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-fg-muted">Members</dt>
              <dd className="font-medium text-fg tabular-nums">{members.length}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-fg-muted">Your role</dt>
              <dd className={billingOnly ? 'font-medium text-fg' : 'font-medium text-fg capitalize'}>{billingOnly ? 'Billing only' : activeOrg.role}</dd>
            </div>
          </dl>
        </section>

        <section
          aria-labelledby="org-danger-heading"
          className="rounded-xl border border-danger/35 bg-panel p-6 shadow-xs"
        >
          <h2 id="org-danger-heading" className="text-base font-semibold text-danger-text">
            Danger zone
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Leaving removes your access to {activeOrg.name} in the Portal and in every KitStak app.
          </p>
          <div className="mt-4">
            <LeaveOrgButton orgId={activeOrg.id} orgName={activeOrg.name} isSoleOwner={isSoleOwner} />
          </div>
        </section>
      </aside>
    </div>
  );
}
