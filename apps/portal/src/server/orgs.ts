/**
 * Organization lookups for the launcher, billing and settings pages. Reads the shared
 * Better Auth tables in `core` directly through Drizzle (same posture as CRM's
 * `findOrgMembership`); writes go through the Better Auth organization endpoints.
 */
import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { member, organization, user } from '@kitstak/db/schema';
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

export interface OrgOwner {
  readonly name: string;
  readonly email: string;
}

/**
 * The organization's owner (billing contact for the upgrade flow). Role strings can be
 * comma lists; deactivated members never match. Oldest owner membership wins so the
 * contact stays stable when ownership is later shared.
 */
export async function getOrgOwner(orgId: string): Promise<OrgOwner | null> {
  const rows = await db
    .select({ name: user.name, email: user.email, role: member.role, createdAt: member.createdAt })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId))
    .orderBy(asc(member.createdAt));
  const owner = rows.find(
    (row) =>
      !row.role.startsWith(DEACTIVATED_PREFIX) &&
      row.role.split(',').some((part) => part.trim() === 'owner'),
  );
  return owner ? { name: owner.name, email: owner.email } : null;
}

export interface OrgGlance {
  /** Active (non-deactivated) memberships. */
  readonly memberCount: number;
  readonly createdAt: Date;
}

/** Headline numbers for the launcher's org-at-a-glance strip; null when the org vanished. */
export async function getOrgGlance(orgId: string): Promise<OrgGlance | null> {
  const [orgRow] = await db
    .select({ createdAt: organization.createdAt })
    .from(organization)
    .where(eq(organization.id, orgId));
  if (!orgRow) return null;
  const memberRows = await db
    .select({ role: member.role })
    .from(member)
    .where(eq(member.organizationId, orgId));
  const memberCount = memberRows.filter((row) => !row.role.startsWith(DEACTIVATED_PREFIX)).length;
  return { memberCount, createdAt: orgRow.createdAt };
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

export interface OrgMemberSummary {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  /** First role of the membership. */
  readonly role: string;
}

/** Active members of an org by name. Used by the billing team page to pick a billing manager. */
export async function listOrgMembers(orgId: string): Promise<OrgMemberSummary[]> {
  const rows = await db
    .select({ userId: user.id, name: user.name, email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId))
    .orderBy(asc(user.name));
  return rows
    .filter((row) => !row.role.startsWith(DEACTIVATED_PREFIX))
    .map((row) => ({ ...row, role: row.role.split(',')[0]?.trim() || 'member' }));
}

/** True when the user is an active member of the org. The test gateway pages check this themselves. */
export async function isActiveOrgMember(userId: string, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ role: member.role, userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, orgId));
  return rows.some((row) => row.userId === userId && !row.role.startsWith(DEACTIVATED_PREFIX));
}
