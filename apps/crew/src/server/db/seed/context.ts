/**
 * Seed helpers (the Pulse pattern): load env, resolve orgs and users by slug and email, and build
 * DomainContexts so seeds write through the domain layer. Import this file first: it loads
 * `.env.local` before the database client is made.
 */
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

const APP_ROOT = path.resolve(__dirname, '../../../..');
loadDotenv({ path: path.join(APP_ROOT, '.env.local'), quiet: true });
loadDotenv({ path: path.join(APP_ROOT, '.env'), quiet: true });

import { and, eq } from 'drizzle-orm';
import { member, organization, user } from '@kitstak/db/schema';
import { db, getPool } from '@/server/db';
import { asSystem } from '@/server/db/scope';
import type { DomainContext } from '@/server/domain/_shared';
import { parseOrgRole } from '@/lib/permissions';

/** A seed reads core rows across workspaces, so its own lookups run as the owner. Domain calls inside stay scoped. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over any seed function shape
export function asSeed<F extends (...args: any[]) => unknown>(fn: F): F {
  return ((...args: unknown[]) => asSystem('demo seed (builds one workspace)', () => (fn as (...inner: unknown[]) => unknown)(...args))) as unknown as F;
}

export const orgBySlug = asSeed(async function orgBySlug(slug: string) {
  const [row] = await db.select().from(organization).where(eq(organization.slug, slug));
  return row ?? null;
});

/** Acts as the first owner of the org (else its first admin, else any member). */
export const seedContext = asSeed(async function seedContext(orgSlug: string): Promise<DomainContext> {
  const org = await orgBySlug(orgSlug);
  if (!org) throw new Error(`Seed: org ${orgSlug} not found. Run the platform seeds first.`);
  const members = await db
    .select({ id: user.id, name: user.name, email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, org.id)));
  const order: Readonly<Record<string, number>> = { owner: 0, admin: 1, member: 2 };
  const rank = (role: string): number => order[parseOrgRole(role) ?? 'guest'] ?? 3;
  const actor = members.filter((row) => parseOrgRole(row.role)).sort((a, b) => rank(a.role) - rank(b.role) || a.email.localeCompare(b.email))[0];
  if (!actor) throw new Error(`Seed: org ${orgSlug} has no members.`);
  return { orgId: org.id, orgSlug: org.slug, userId: actor.id, userName: actor.name, orgRole: parseOrgRole(actor.role)!, actorKind: 'user' };
});

export async function closeSeed(): Promise<void> {
  await getPool().end();
}
