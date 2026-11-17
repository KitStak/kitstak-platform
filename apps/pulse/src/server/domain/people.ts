/** Org people (core.member × core.user): pickers, owners, assignees, avatars. */
import 'server-only';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { member, user } from '@kitstak/db/schema';
import { db, type Executor } from '@/server/db';
import { parseOrgRole } from '@/lib/permissions';
import type { OrgPerson, PersonRef } from '@/lib/types';
import type { DomainContext } from './_shared';
import { wmsTable } from '@kitstak/db/wms-tenants';
import { wmsTableExists, wmsTenantSchemaFor } from '@/server/integrations/detect';

/**
 * Emails of system accounts (API / integration users) that must never show up as teammates in
 * pickers. Today that is WMS's `is_api_user` flag (the shared Integration Service login), read
 * from the org's own warehouse schema. Fails soft: no warehouse, no users table, or any error,
 * means no exclusions.
 */
async function serviceAccountEmails(orgId: string): Promise<Set<string>> {
  try {
    const schema = await wmsTenantSchemaFor(orgId);
    if (!schema || !(await wmsTableExists(schema, 'users'))) return new Set();
    // Always on the pool (never inside a caller's transaction, so a failure can't abort it).
    const result = await db.execute<{ email: string }>(
      sql`select lower(email) as email from ${wmsTable(schema, 'users')} where is_api_user = true`,
    );
    return new Set(result.rows.map((row) => row.email));
  } catch {
    return new Set();
  }
}

/** Every active human member of the org, alphabetical (service accounts are left out of pickers). */
export async function listOrgPeople(ctx: DomainContext, executor: Executor = db): Promise<OrgPerson[]> {
  const [rows, serviceEmails] = await Promise.all([
    executor
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
    .orderBy(asc(user.name)),
    serviceAccountEmails(ctx.orgId),
  ]);
  const out: OrgPerson[] = [];
  for (const row of rows) {
    if (serviceEmails.has(row.email.toLowerCase())) continue;
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

/** Filters ids down to active org members (owner and assignee validation). */
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
