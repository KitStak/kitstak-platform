import { notFound, redirect } from 'next/navigation';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/server/db';
import { boards, member } from '@/server/db/schema';
import { getSession } from '@/server/auth/session';

/** `/dev/board-table` → the signed-in user's Deals board (or their first board). */
export default async function DevBoardTableIndex() {
  if (process.env.NODE_ENV === 'production') notFound();
  const session = await getSession();
  if (!session) redirect('/login?next=%2Fdev%2Fboard-table');
  const orgIds = (
    await db.select({ orgId: member.organizationId }).from(member).where(eq(member.userId, session.user.id))
  ).map((row) => row.orgId);
  if (!orgIds.length) notFound();
  const rows = await db
    .select({ id: boards.id, name: boards.name })
    .from(boards)
    .where(and(inArray(boards.orgId, orgIds), isNull(boards.deletedAt), isNull(boards.archivedAt)))
    .orderBy(asc(boards.name))
    .limit(200);
  const target = rows.find((row) => row.name === 'Deals') ?? rows[0];
  if (!target) notFound();
  redirect(`/dev/board-table/${target.id}`);
}
