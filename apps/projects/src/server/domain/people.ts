/** Org people (core.member × core.user): pickers, mentions, assignees, avatars. */
import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { member, user } from '@kitstak/db/schema';
import { db, type Executor } from '@/server/db';
import { parseOrgRole } from '@/lib/permissions';
import type { OrgPerson, PersonRef } from '@/lib/types';
import type { DomainContext } from './_shared';

/** Every active member of the org, alphabetical. */
export async function listOrgPeople(ctx: DomainContext, executor: Executor = db): Promise<OrgPerson[]> {
  const rows = await executor
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      title: user.title,
      role: member.role,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, ctx.orgId))
    .orderBy(asc(user.name));
  const out: OrgPerson[] = [];
  for (const row of rows) {
    const orgRole = parseOrgRole(row.role);
    if (!orgRole) continue;
    out.push({ id: row.id, name: row.name, email: row.email, image: row.image, title: row.title, orgRole });
  }
  return out;
}

/** True when the user is an active member of the actor's org. */
export async function isOrgMember(ctx: DomainContext, userId: string, executor: Executor = db): Promise<boolean> {
  const [row] = await executor
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, userId)));
  return Boolean(row && parseOrgRole(row.role));
}

/** Filters ids down to active org members (assignee / mention validation). */
export async function filterOrgMembers(
  ctx: DomainContext,
  userIds: readonly string[],
  executor: Executor = db,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await executor
    .select({ userId: member.userId, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, ctx.orgId), inArray(member.userId, [...new Set(userIds)])));
  return rows.filter((row) => parseOrgRole(row.role)).map((row) => row.userId);
}

export async function getPeople(ids: readonly string[], executor: Executor = db): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await executor
    .select({ id: user.id, name: user.name, email: user.email, image: user.image })
    .from(user)
    .where(inArray(user.id, unique));
  return new Map(rows.map((row) => [row.id, row]));
}
