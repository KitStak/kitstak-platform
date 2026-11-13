import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getPageOrgMembership, getSession } from '@/server/auth/session';
import { passwordChangeRedirect } from '@/server/auth/password-change';
import type { OrgContextValue } from '@/features/shell/org-context';
import { ShellClient } from './shell-client';

interface OrgLayoutProps {
  readonly children: React.ReactNode;
  readonly params: Promise<{ orgSlug: string }>;
}

export async function generateMetadata({ params }: OrgLayoutProps): Promise<Metadata> {
  const { orgSlug } = await params;
  const result = await getPageOrgMembership(orgSlug);
  return { title: { default: result?.membership.organization.name ?? 'KitStak', template: '%s · KitStak' } };
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
  };

  return <ShellClient context={context}>{children}</ShellClient>;
}
