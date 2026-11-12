import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getPageOrgMembership } from '@/server/auth/session';
import { NotFoundError } from '@/server/http/errors';
import { requireWorkspace } from '@/server/services/access';
import { serviceContext } from '@/server/services/context';

interface WorkspaceLayoutProps {
  readonly children: React.ReactNode;
  readonly params: Promise<{ orgSlug: string; workspaceId: string }>;
}

const idSchema = z.uuid();

/**
 * Server gate for the workspace overview. It sits ABOVE this segment's loading boundary, so a
 * malformed, unknown, deleted or inaccessible workspace id answers with a real HTTP 404 before
 * anything streams (a notFound() inside a Suspense boundary would already have sent 200).
 */
export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  const { orgSlug, workspaceId } = await params;
  if (!idSchema.safeParse(workspaceId).success) notFound();
  const result = await getPageOrgMembership(orgSlug);
  if (!result) notFound();
  try {
    await requireWorkspace(serviceContext({ org: result.membership, user: result.session.user }), workspaceId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  return children;
}
