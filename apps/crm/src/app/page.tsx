import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { requirePageSession } from '@/server/auth/session';
import { db } from '@/server/db';
import { member, organization } from '@/server/db/schema';

/** Entry point: send the user to their active (or first) organization, or to onboarding. */
export default async function RootPage() {
  const session = await requirePageSession();
  const rows = await db
    .select({ id: organization.id, slug: organization.slug })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, session.user.id))
    .orderBy(asc(member.createdAt));

  const active = rows.find((row) => row.id === session.session.activeOrganizationId) ?? rows[0];
  redirect(active ? `/${active.slug}` : '/welcome');
}
