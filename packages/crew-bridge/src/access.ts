/**
 * A person's Crew role (docs/crew/SPEC.md section 3.1), the first of these that applies:
 *   1. their row in `crew.member_roles` (set by an admin or by the claim step);
 *   2. their org role: owner gives owner, admin gives admin, member gives
 *      `crew.settings.default_member_role` (default none), viewer and guest give none.
 * Being linked to a Crew person never grants a role by itself.
 *
 * `resolveRole` is the pure half, so the Crew app, sibling apps and tests share the exact rule.
 */
import { sql } from 'drizzle-orm';
import { crewAvailability, isUuid, queryOne, type BridgeExecutor } from './executor';
import {
  CREW_ROLES,
  DEFAULT_MEMBER_ROLES,
  NO_CREW_ACCESS,
  type CrewAccess,
  type CrewReader,
  type CrewRole,
  type DefaultMemberRole,
  type OrgRole,
} from './types';

const RANK: Readonly<Record<CrewRole, number>> = { owner: 6, admin: 5, payroll: 4, supervisor: 3, lead: 2, viewer: 1, none: 0 };
const ORG_RANK: Readonly<Record<OrgRole, number>> = { owner: 5, admin: 4, member: 3, viewer: 2, guest: 1 };

export function isCrewRole(value: unknown): value is CrewRole {
  return typeof value === 'string' && (CREW_ROLES as readonly string[]).includes(value);
}

export function isDefaultMemberRole(value: unknown): value is DefaultMemberRole {
  return typeof value === 'string' && (DEFAULT_MEMBER_ROLES as readonly string[]).includes(value);
}

/** True when `role` is at least `min` (owner > admin > payroll > supervisor > lead > viewer > none). */
export function crewRoleAtLeast(role: CrewRole | null | undefined, min: CrewRole): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[min];
}

/** Better Auth stores roles as a comma list ("admin,member"); CRM prefixes deactivated members. */
export function parseOrgRole(raw: string | null | undefined): OrgRole | null {
  if (!raw || raw.startsWith('deactivated:')) return null;
  let best: OrgRole | null = null;
  for (const part of raw.split(',')) {
    const role = part.trim() as OrgRole;
    if (!(role in ORG_RANK)) continue;
    if (!best || ORG_RANK[role] > ORG_RANK[best]) best = role;
  }
  return best;
}

/** Step 2 alone: the org role. */
export function crewRoleFromOrgRole(orgRole: OrgRole | null | undefined, defaultMemberRole: DefaultMemberRole = 'none'): CrewRole {
  if (orgRole === 'owner') return 'owner';
  if (orgRole === 'admin') return 'admin';
  if (orgRole === 'member') return defaultMemberRole;
  return 'none';
}

/** Pay type, wages and payroll exports: owner, admin and payroll (SPEC 3.2). */
export const canSeePay = (role: CrewRole): boolean => crewRoleAtLeast(role, 'payroll');
/** Emergency contact, home address and phone: supervisor and up (SPEC 3.2). */
export const canSeePrivate = (role: CrewRole): boolean => crewRoleAtLeast(role, 'supervisor');

export interface RoleInputs {
  /** The person's `crew.member_roles` row, when there is one. */
  readonly explicit: { readonly role: string; readonly siteIds: readonly string[] | null } | null;
  readonly orgRole: OrgRole | null;
  readonly defaultMemberRole: string | null | undefined;
  readonly linkedPersonId?: string | null;
}

/** The whole resolver as one pure function. A person who is not in the org (no org role) gets none. */
export function resolveRole(input: RoleInputs): CrewAccess {
  if (!input.orgRole) return NO_CREW_ACCESS;
  const fallback = isDefaultMemberRole(input.defaultMemberRole) ? input.defaultMemberRole : 'none';
  const explicitRole = input.explicit && isCrewRole(input.explicit.role) ? input.explicit.role : null;
  const role = explicitRole ?? crewRoleFromOrgRole(input.orgRole, fallback);
  const scoped = role === 'supervisor' || role === 'lead';
  const siteIds = scoped && explicitRole && input.explicit?.siteIds ? [...input.explicit.siteIds] : null;
  return {
    role,
    siteIds,
    canSeePay: canSeePay(role),
    canSeePrivate: canSeePrivate(role),
    source: explicitRole ? 'explicit' : 'org',
    linkedPersonId: input.linkedPersonId ?? null,
  };
}

/**
 * The reader's Crew access, read from the shared database. Never throws: no Crew schema, a
 * person who is not a member, a bad id or any error answer `NO_CREW_ACCESS` (role none).
 */
export async function resolveCrewAccess(db: BridgeExecutor, who: CrewReader): Promise<CrewAccess> {
  if (!isUuid(who.orgId) || !isUuid(who.userId)) return NO_CREW_ACCESS;
  try {
    if (!(await crewAvailability(db)).installed) return NO_CREW_ACCESS;
    const row = await queryOne<{ org_role: string | null; crew_role: string | null; site_ids: string[] | null; default_member_role: string | null; person_id: string | null }>(
      db,
      sql`select m.role as org_role, mr.role as crew_role, mr.site_ids, s.default_member_role, p.id as person_id
            from (select 1) one
            left join core.member m on m.organization_id = ${who.orgId} and m.user_id = ${who.userId}
            left join crew.member_roles mr on mr.org_id = ${who.orgId} and mr.user_id = ${who.userId}
            left join crew.settings s on s.org_id = ${who.orgId}
            left join crew.people p on p.org_id = ${who.orgId} and p.user_id = ${who.userId} and p.deleted_at is null and p.status <> 'ended'
           limit 1`,
    );
    if (!row) return NO_CREW_ACCESS;
    return resolveRole({
      explicit: row.crew_role ? { role: row.crew_role, siteIds: row.site_ids } : null,
      orgRole: parseOrgRole(row.org_role),
      defaultMemberRole: row.default_member_role,
      linkedPersonId: row.person_id,
    });
  } catch {
    return NO_CREW_ACCESS;
  }
}
