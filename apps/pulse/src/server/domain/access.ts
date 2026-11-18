/**
 * Authoritative permission checks. Every domain read and write starts with `requirePulse`.
 * Rules live in src/lib/permissions.ts (pure, unit tested).
 *
 * `pulseAccessFor` is the single place that turns an actor into a Pulse role (SPEC section 3).
 * A person's role is the first of these that applies:
 *   1. their explicit row in `pulse.member_roles`,
 *   2. their role in the org's own warehouse (WMS users, matched by email),
 *   3. their org role (members get `settings.default_member_role`).
 * `resolveAccess` is the pure half, so sibling apps and tests share the exact rule.
 */
import 'server-only';
import { cache } from 'react';
import { eq, sql } from 'drizzle-orm';
import { user } from '@kitstak/db/schema';
import { wmsTable } from '@kitstak/db/wms-tenants';
import { db } from '@/server/db';
import { forbidden } from '@/server/errors';
import { wmsTableExists, wmsTenantSchemaFor } from '@/server/integrations/detect';
import {
  canPulse,
  canSeeMoney,
  canSeeWages,
  isPulseRole,
  pulseRoleFromOrgRole,
  type OrgRole,
  type PulseAction,
  type PulseRole,
} from '@/lib/permissions';
import type { DomainContext } from './_shared';

export interface PulseAccess {
  readonly role: PulseRole;
  /** `money:read`: revenue, cost, profit and margin fields are filled in. */
  readonly seesMoney: boolean;
  /** `wage:read`: wage, tax and benefit detail of a labor rate. */
  readonly seesWages: boolean;
  /** Which step of the resolver decided the role (shown on People and roles). */
  readonly source: 'system' | 'explicit' | 'wms' | 'org';
  /** The per person "sees money" switch on the explicit row. */
  readonly seesMoneySwitch: boolean;
}

export const SYSTEM_ACCESS: PulseAccess = { role: 'owner', seesMoney: true, seesWages: true, source: 'system', seesMoneySwitch: true };

/** Pure half of step 2: a WMS user row to a Pulse role. `null` means "no opinion, try the next step". */
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

export interface AccessInputs {
  /** The person's `pulse.member_roles` row, when there is one. */
  readonly explicit: { readonly role: string; readonly seesMoney: boolean } | null;
  /** The role their warehouse user row gives, or null for "no opinion". */
  readonly wmsRole: PulseRole | null;
  readonly orgRole: OrgRole | null;
  readonly defaultMemberRole: PulseRole;
}

/** The whole resolver as one pure function (SPEC section 3). */
export function resolveAccess(input: AccessInputs): PulseAccess {
  const explicitRole = input.explicit && isPulseRole(input.explicit.role) ? input.explicit.role : null;
  const seesMoneySwitch = Boolean(input.explicit?.seesMoney);
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
  return { role, source, seesMoneySwitch, seesMoney: canSeeMoney(role, seesMoneySwitch), seesWages: canSeeWages(role) };
}

/** Step 2: the person's active user row in the org's own warehouse. Fails soft to "no opinion". */
async function wmsRole(orgId: string, userId: string): Promise<PulseRole | null> {
  try {
    const schema = await wmsTenantSchemaFor(orgId);
    if (!schema || !(await wmsTableExists(schema, 'users'))) return null;
    const [person] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
    if (!person) return null;
    const result = await db.execute<{ user_type: string | null; role: string | null; is_api_user: boolean }>(
      sql`select user_type, role, is_api_user from ${wmsTable(schema, 'users')} where lower(email) = ${person.email.toLowerCase()} and is_active = true limit 1`,
    );
    const row = result.rows[0];
    if (!row) return null;
    return pulseRoleFromWmsUser({ userType: row.user_type, role: row.role, isApiUser: Boolean(row.is_api_user) });
  } catch {
    return null;
  }
}

/** Warehouse roles of everyone in the org, by lowercased email (People and roles). Fails soft to empty. */
export async function wmsRolesByEmail(orgId: string): Promise<Map<string, PulseRole>> {
  const out = new Map<string, PulseRole>();
  try {
    const schema = await wmsTenantSchemaFor(orgId);
    if (!schema || !(await wmsTableExists(schema, 'users'))) return out;
    const result = await db.execute<{ email: string; user_type: string | null; role: string | null; is_api_user: boolean }>(
      sql`select lower(email) as email, user_type, role, is_api_user from ${wmsTable(schema, 'users')} where is_active = true`,
    );
    for (const row of result.rows) {
      const role = pulseRoleFromWmsUser({ userType: row.user_type, role: row.role, isApiUser: Boolean(row.is_api_user) });
      if (role) out.set(row.email, role);
    }
  } catch {
    return out;
  }
  return out;
}

async function explicitRow(orgId: string, userId: string): Promise<{ explicit: AccessInputs['explicit']; defaultMemberRole: PulseRole }> {
  const result = await db.execute<{ role: string | null; sees_money: boolean | null; default_member_role: string | null }>(
    sql`select mr.role, mr.sees_money, s.default_member_role
          from (select 1) one
          left join pulse.member_roles mr on mr.org_id = ${orgId} and mr.user_id = ${userId}
          left join pulse.settings s on s.org_id = ${orgId}`,
  );
  const row = result.rows[0];
  const fallback = row?.default_member_role;
  return {
    explicit: row?.role ? { role: row.role, seesMoney: Boolean(row.sees_money) } : null,
    defaultMemberRole: isPulseRole(fallback) ? fallback : 'none',
  };
}

async function resolveNow(orgId: string, userId: string, orgRole: OrgRole): Promise<PulseAccess> {
  const { explicit, defaultMemberRole } = await explicitRow(orgId, userId);
  // The warehouse is only asked when no explicit row decides.
  const fromWms = explicit ? null : await wmsRole(orgId, userId);
  return resolveAccess({ explicit, wmsRole: fromWms, orgRole, defaultMemberRole });
}

const resolve = cache(resolveNow);

export async function pulseAccessFor(ctx: DomainContext): Promise<PulseAccess> {
  if (ctx.actorKind !== 'user') return SYSTEM_ACCESS;
  return resolve(ctx.orgId, ctx.userId, ctx.orgRole);
}

/** Same as `pulseAccessFor` with no per request memo (right after a role change). */
export async function freshPulseAccess(ctx: DomainContext): Promise<PulseAccess> {
  if (ctx.actorKind !== 'user') return SYSTEM_ACCESS;
  return resolveNow(ctx.orgId, ctx.userId, ctx.orgRole);
}

export function accessDenied(role: PulseRole): Error {
  return forbidden(
    role === 'none'
      ? 'You do not have access to KitStak Pulse yet. Ask an admin of your workspace to give you a role.'
      : 'Your Pulse role cannot do this. Ask an admin of your workspace if you need it.',
  );
}

/** Throws FORBIDDEN unless the actor may perform `action`. Returns the resolved access. */
export async function requirePulse(ctx: DomainContext, action: PulseAction): Promise<PulseAccess> {
  const access = await pulseAccessFor(ctx);
  if (!canPulse(access.role, action)) throw accessDenied(access.role);
  return access;
}

/** Throws FORBIDDEN unless the actor may read money (rate endpoints, money reports). */
export async function requireMoney(ctx: DomainContext): Promise<PulseAccess> {
  const access = await requirePulse(ctx, 'pulse:read');
  if (!access.seesMoney) throw forbidden('Your Pulse role does not include money. Ask an admin of your workspace if you need it.');
  return access;
}
