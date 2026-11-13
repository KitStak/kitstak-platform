/**
 * Seed helpers: load env, resolve orgs/users by slug/email, and build DomainContexts so seeds
 * write through the real domain layer (activity, numbering, ranks all stay correct).
 */
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

const APP_ROOT = path.resolve(__dirname, '../../../..');
loadDotenv({ path: path.join(APP_ROOT, '.env.local'), quiet: true });
loadDotenv({ path: path.join(APP_ROOT, '.env'), quiet: true });

import { and, eq } from 'drizzle-orm';
import { member, organization, user } from '@kitstak/db/schema';
import { db, getPool } from '@/server/db';
import type { DomainContext } from '@/server/domain/_shared';
import { parseOrgRole } from '@/lib/permissions';

export async function orgBySlug(slug: string) {
  const [row] = await db.select().from(organization).where(eq(organization.slug, slug));
  return row ?? null;
}

export async function userByEmail(email: string) {
  const [row] = await db.select().from(user).where(eq(user.email, email));
  return row ?? null;
}

/** Members of an org (id, name, email, role). */
export async function orgMembers(orgId: string) {
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, orgId));
  return rows.filter((row) => parseOrgRole(row.role));
}

/** Acts as `email` in `orgSlug`. The seed runs as an org owner so every write is allowed. */
export async function seedContext(orgSlug: string, email: string): Promise<DomainContext> {
  const org = await orgBySlug(orgSlug);
  if (!org) throw new Error(`Seed: org ${orgSlug} not found. Run the platform seeds first.`);
  const actor = await userByEmail(email);
  if (!actor) throw new Error(`Seed: user ${email} not found.`);
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, org.id), eq(member.userId, actor.id)));
  if (!membership) throw new Error(`Seed: ${email} is not a member of ${orgSlug}.`);
  return { orgId: org.id, orgSlug: org.slug, userId: actor.id, userName: actor.name, orgRole: 'owner', actorKind: 'user' };
}

export async function closeSeed(): Promise<void> {
  await getPool().end();
}
