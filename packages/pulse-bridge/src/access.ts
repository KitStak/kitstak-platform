/**
 * Who a person is in Pulse. One rule, shared by every app (docs/pulse/SPEC.md section 3).
 * A person's role is the first of these that applies:
 *   1. their explicit row in `pulse.member_roles`,
 *   2. their role in the organization's own warehouse (WMS users, matched by email),
 *   3. their organization role (members get `pulse.settings.default_member_role`).
 * `resolveAccess` is the pure half. Pulse's own resolver (apps/pulse/src/server/domain/access.ts)
 * follows the same steps, and apps/pulse/src/server/integrations/bridge-parity.test.ts proves
 * the two agree for every combination of inputs.
 */
import { sql } from 'drizzle-orm';
import { queryOne, type BridgeExecutor } from './executor';
import { PULSE_ROLES, type PulseAccess, type PulseReader, type PulseRole } from './types';

const RANK: Readonly<Record<PulseRole, number>> = { owner: 5, admin: 4, manager: 3, supervisor: 2, viewer: 1, none: 0 };

export function isPulseRole(value: unknown): value is PulseRole {
  return typeof value === 'string' && (PULSE_ROLES as readonly string[]).includes(value);
}

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer' | 'guest';
const ORG_RANK: Readonly<Record<OrgRole, number>> = { owner: 5, admin: 4, member: 3, viewer: 2, guest: 1 };

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

/** Step 2: a warehouse user row to a Pulse role. `null` means "no opinion, try the next step". */
export function pulseRoleFromWmsUser(row: { readonly userType: string | null; readonly role: string | null; readonly isApiUser: boolean }): PulseRole | null {
  if (row.isApiUser) return 'none';
  const userType = (row.userType ?? '').toLowerCase();
  const role = (row.role ?? '').toLowerCase();
  if (userType === 'client') return 'none';
  if (userType === 'owner' || role === 'admin') return 'admin';
  if (role === 'manager') return 'manager';
  if (role === 'operator') return 'supervisor';
  if (role === 'viewer' && userType === 'operation') return 'viewer';
  return null;
}

/** Step 3: the organization role alone. */
export function pulseRoleFromOrgRole(orgRole: OrgRole | null | undefined, defaultMemberRole: PulseRole = 'none'): PulseRole {
  if (orgRole === 'owner') return 'owner';
  if (orgRole === 'admin') return 'admin';
  if (orgRole === 'member') return defaultMemberRole;
  return 'none';
}

export interface AccessInputs {
  readonly explicit: { readonly role: string; readonly seesMoney: boolean } | null;
  readonly wmsRole: PulseRole | null;
  readonly orgRole: OrgRole | null;
  readonly defaultMemberRole: PulseRole;
}

const atLeast = (role: PulseRole, min: PulseRole): boolean => role !== 'none' && RANK[role] >= RANK[min];

/** The whole resolver as one pure function. */
export function resolveAccess(input: AccessInputs): PulseAccess {
  const explicitRole = input.explicit && isPulseRole(input.explicit.role) ? input.explicit.role : null;
  const moneySwitch = Boolean(input.explicit?.seesMoney);
  let role: PulseRole;
  let source: PulseAccess['source'];
  if (explicitRole) {
    role = explicitRole;
    source = 'explicit';
  } else if (input.wmsRole) {
    role = input.wmsRole;
    source = 'wms';
  } else {
    role = pulseRoleFromOrgRole(input.orgRole, input.defaultMemberRole);
    source = 'org';
  }
  return {
    role,
    source,
    seesMoney: role !== 'none' && (atLeast(role, 'manager') || moneySwitch),
    seesWages: atLeast(role, 'admin'),
    canLog: atLeast(role, 'supervisor'),
    canManageJobs: atLeast(role, 'manager'),
  };
}

export const NO_ACCESS: PulseAccess = { role: 'none', source: 'org', seesMoney: false, seesWages: false, canLog: false, canManageJobs: false };

const WMS_SCHEMA = /^wms(_[0-9a-f]{32})?$/;

/**
 * The person's Pulse access in this organization. A person who is not a member of the
 * organization has no access. Never throws: any error reads as "no access".
 */
export async function resolvePulseAccess(db: BridgeExecutor, who: PulseReader): Promise<PulseAccess> {
  try {
    const row = await queryOne<{
      org_role: string | null;
      pulse_role: string | null;
      sees_money: boolean | null;
      default_member_role: string | null;
      email: string | null;
      wms_schema: string | null;
    }>(
      db,
      sql`select m.role as org_role, mr.role as pulse_role, mr.sees_money, s.default_member_role, u.email,
                 (select t.schema_name from core.wms_tenants t where t.org_id = ${who.orgId}::uuid and t.status = 'active' limit 1) as wms_schema
            from core.member m
            join core."user" u on u.id = m.user_id
            left join pulse.member_roles mr on mr.org_id = m.organization_id and mr.user_id = m.user_id
            left join pulse.settings s on s.org_id = m.organization_id
           where m.organization_id = ${who.orgId}::uuid and m.user_id = ${who.userId}::uuid
           limit 1`,
    );
    if (!row) return NO_ACCESS;
    const orgRole = parseOrgRole(row.org_role);
    if (!orgRole) return NO_ACCESS;
    const explicit = row.pulse_role ? { role: row.pulse_role, seesMoney: Boolean(row.sees_money) } : null;
    let wmsRole: PulseRole | null = null;
    if (!explicit && row.email && row.wms_schema && WMS_SCHEMA.test(row.wms_schema)) {
      wmsRole = await wmsRoleOf(db, row.wms_schema, row.email);
    }
    return resolveAccess({
      explicit,
      wmsRole,
      orgRole,
      defaultMemberRole: isPulseRole(row.default_member_role) ? row.default_member_role : 'none',
    });
  } catch {
    return NO_ACCESS;
  }
}

async function wmsRoleOf(db: BridgeExecutor, schema: string, email: string): Promise<PulseRole | null> {
  try {
    const exists = await queryOne<{ ok: boolean }>(db, sql`select to_regclass(${`"${schema}"."users"`}) is not null as ok`);
    if (!exists?.ok) return null;
    const row = await queryOne<{ user_type: string | null; role: string | null; is_api_user: boolean | null }>(
      db,
      sql`select user_type, role, is_api_user from ${sql.identifier(schema)}.${sql.identifier('users')}
           where lower(email) = ${email.toLowerCase()} and is_active = true limit 1`,
    );
    if (!row) return null;
    return pulseRoleFromWmsUser({ userType: row.user_type, role: row.role, isApiUser: Boolean(row.is_api_user) });
  } catch {
    return null;
  }
}
