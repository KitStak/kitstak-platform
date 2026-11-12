import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/server/db';
import { boards } from '@/server/db/schema';
import { findOrgMembership, getSession } from '@/server/auth/session';
import { DevBoardTable } from './dev-board-table';

export const metadata: Metadata = { title: 'Board table (dev)', robots: { index: false, follow: false } };

interface PageProps {
  readonly params: Promise<{ boardId: string }>;
  readonly searchParams: Promise<{ perf?: string }>;
}

/**
 * Dev-only harness for the board table on a real board (e.g. the seeded Deals board).
 * `?perf=5000` pads the board with synthetic read-only rows to check virtualization.
 */
export default async function DevBoardTablePage({ params, searchParams }: PageProps) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { boardId } = await params;
  const { perf } = await searchParams;
  if (!z.uuid().safeParse(boardId).success) notFound();
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/dev/board-table/${boardId}`)}`);

  const [board] = await db
    .select({ orgId: boards.orgId })
    .from(boards)
    .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)))
    .limit(1);
  // Same response for "missing" and "not a member": no existence leak.
  const membership = board ? await findOrgMembership(session.user.id, board.orgId) : null;
  if (!board || !membership) notFound();

  const perfRows = Math.min(10_000, Math.max(0, Number.parseInt(perf ?? '0', 10) || 0));
  return (
    <DevBoardTable
      orgId={membership.organization.id}
      boardId={boardId}
      userId={session.user.id}
      perfRows={perfRows}
    />
  );
}
