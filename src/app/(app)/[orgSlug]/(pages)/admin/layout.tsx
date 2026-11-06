import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { recordAudit } from '@/server/audit';
import { getPageOrgMembership } from '@/server/auth/session';
import { clientIp } from '@/server/http/request';
import { hasPermission } from '@/server/rbac';
import { AdminShell } from '@/features/admin/admin-shell';
import { AdminForbidden } from '@/features/admin/forbidden';
import { ROLE_LABEL } from '@/features/admin/format';

interface AdminLayoutProps {
  readonly children: React.ReactNode;
  readonly params: Promise<{ orgSlug: string }>;
}

/**
 * Server-side gate for the whole admin center: only roles with `org:update` (owner, admin) get
 * the shell. Anyone else sees an explanation and the attempt lands in the audit log.
 */
export default async function AdminLayout({ children, params }: AdminLayoutProps) {
  const { orgSlug } = await params;
  const result = await getPageOrgMembership(orgSlug);
  if (!result) notFound();
  const { membership, session } = result;
  if (!hasPermission(membership.roles, 'org:update')) {
    const requestHeaders = await headers();
    await recordAudit({
      orgId: membership.organization.id,
      actorId: session.user.id,
      action: 'auth.forbidden',
      targetType: 'page',
      targetId: 'admin',
      ipAddress: clientIp(requestHeaders),
      userAgent: requestHeaders.get('user-agent'),
      metadata: { path: `/${orgSlug}/admin`, role: membership.role },
    });
    return <AdminForbidden orgSlug={orgSlug} roleLabel={ROLE_LABEL[membership.role]} />;
  }
  return <AdminShell>{children}</AdminShell>;
}
