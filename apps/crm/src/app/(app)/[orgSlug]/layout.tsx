import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getPageOrgMembership, getSession } from '@/server/auth/session';
import { passwordChangeRedirect } from '@/server/auth/password-change';
import type { OrgContextValue } from '@/features/shell/org-context';
import { orgModuleFlags } from '@/server/entitlements';
import { env } from '@/server/env';
import { crmBillingLink, getPlanView, portalUrl } from '@/server/plan';
import { ShellClient } from './shell-client';

interface OrgLayoutProps {
  readonly children: React.ReactNode;
  readonly params: Promise<{ orgSlug: string }>;
}

export async function generateMetadata({ params }: OrgLayoutProps): Promise<Metadata> {
  const { orgSlug } = await params;
  const result = await getPageOrgMembership(orgSlug);
  return { title: { default: result ? `${result.membership.organization.name} · KitStak CRM` : 'KitStak CRM', template: '%s · KitStak CRM' } };
}

/**
 * Authenticated org frame. Validates the session and org membership on the server (the proxy's
 * cookie check is only optimistic), then renders the client shell with the caller's permissions.
 */
export default async function OrgLayout({ children, params }: OrgLayoutProps) {
  const { orgSlug } = await params;
  const result = await getPageOrgMembership(orgSlug);
  if (!result) {
    const session = await getSession();
    if (!session) redirect(`/login?next=${encodeURIComponent(`/${orgSlug}`)}`);
    notFound(); // signed in but not a member: do not reveal whether the org exists
  }

  const { session, membership } = result;
  // An administrator-set password has to be replaced first; the portal hosts that screen.
  const changePasswordUrl = await passwordChangeRedirect(session.user.id, membership.organization.slug);
  if (changePasswordUrl) redirect(changePasswordUrl);
  const [entitled, plan] = await Promise.all([
    orgModuleFlags(membership.organization.id),
    getPlanView({ orgId: membership.organization.id, userId: session.user.id, role: membership.roleString }),
  ]);
  const context: OrgContextValue = {
    org: {
      id: membership.organization.id,
      slug: membership.organization.slug,
      name: membership.organization.name,
      logo: membership.organization.logo,
    },
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    },
    role: membership.role,
    permissions: membership.permissions,
    apps: {
      urls: {
        portal: portalUrl(),
        crm: env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3100',
        wms: process.env.NEXT_PUBLIC_WMS_URL || 'http://localhost:3000',
        projects: env.NEXT_PUBLIC_PROJECTS_URL,
        pulse: env.NEXT_PUBLIC_PULSE_URL,
      },
      entitled,
      // Plan state per app (Trial, Active, Payment due, View only, Not in your plan, Included).
      // A row that is not in the plan opens the plan picker with that app turned on.
      planBadges: plan.badges,
      addHrefs: {
        crm: crmBillingLink({ to: 'add', product: 'crm' }),
        wms: crmBillingLink({ to: 'add', product: 'wms' }),
        projects: crmBillingLink({ to: 'add', product: 'projects' }),
        pulse: crmBillingLink({ to: 'add', product: 'pulse' }),
      },
    },
    plan: { access: plan.access === 'read_only' ? 'read_only' : 'full', notice: plan.notice },
  };

  return <ShellClient context={context}>{children}</ShellClient>;
}
