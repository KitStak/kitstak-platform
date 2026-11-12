/**
 * Organization lookups for the launcher, billing and settings pages. Reads the shared
 * Better Auth tables in `core` directly through Drizzle (same posture as CRM's
 * `findOrgMembership`); writes go through the Better Auth organization endpoints.
 */
import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { member, organization } from '@kitstak/db/schema';
import { db } from '@/server/db';
import type { Session } from '@/server/session';

/** CRM marks deactivated members by prefixing the stored role; they resolve to no access. */
const DEACTIVATED_PREFIX = 'deactivated:';

export interface OrgSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo: string | null;
  /** First role string of the caller's membership ('owner' | 'admin' | 'member' | ...). */
  readonly role: string;
}

/** Every organization the user is an active member of, alphabetically. */
export async function listUserOrgs(userId: string): Promise<OrgSummary[]> {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name));
  return rows
    .filter((row) => !row.role.startsWith(DEACTIVATED_PREFIX))
    .map((row) => ({ ...row, role: row.role.split(',')[0]?.trim() || 'member' }));
}

/**
 * The org the launcher should show: the session's active organization when the user is
 * still a member of it, otherwise the first org, otherwise null (no-org empty state).
 */
export async function resolveActiveOrg(
  session: Session,
  orgs?: readonly OrgSummary[],
): Promise<OrgSummary | null> {
  const memberships = orgs ?? (await listUserOrgs(session.user.id));
  if (memberships.length === 0) return null;
  const activeId = session.session.activeOrganizationId;
  return memberships.find((org) => org.id === activeId) ?? memberships[0];
}
