import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getPageOrgMembership, getSession } from '@/server/auth/session';
import type { OrgContextValue } from '@/features/shell/org-context';
import { orgModuleFlags } from '@/server/entitlements';
import { env } from '@/server/env';
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
  const entitled = await orgModuleFlags(membership.organization.id);
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
        portal: process.env.NEXT_PUBLIC_PORTAL_URL || 'http://localhost:3300',
        crm: env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3100',
        wms: process.env.NEXT_PUBLIC_WMS_URL || 'http://localhost:3000',
        projects: env.NEXT_PUBLIC_PROJECTS_URL,
      },
      entitled,
    },
  };

  return <ShellClient context={context}>{children}</ShellClient>;
}
