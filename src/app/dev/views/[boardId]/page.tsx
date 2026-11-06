import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { findOrgMembership, getSession } from '@/server/auth/session';
import { db } from '@/server/db';
import { boards } from '@/server/db/schema';
import { ViewsWorkbench } from './workbench';

export const metadata: Metadata = { title: 'Board views', robots: { index: false, follow: false } };

interface PageProps {
  readonly params: Promise<{ boardId: string }>;
}

/** Dev-only review surface: every board view of one board behind a switcher. */
export default async function DevViewsPage({ params }: PageProps) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { boardId } = await params;
  if (!z.uuid().safeParse(boardId).success) notFound();
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/dev/views/${boardId}`)}`);
  const [board] = await db
    .select({ orgId: boards.orgId })
    .from(boards)
    .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)))
    .limit(1);
  if (!board) notFound();
  const membership = await findOrgMembership(session.user.id, board.orgId);
  if (!membership) notFound();
  return <ViewsWorkbench boardId={boardId} orgId={membership.organization.id} />;
}
