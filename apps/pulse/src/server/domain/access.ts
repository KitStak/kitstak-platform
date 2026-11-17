/**
 * Authoritative permission checks. Every domain read and write starts with `requirePulse`.
 * Rules live in src/lib/permissions.ts (pure, unit tested).
 *
 * `pulseAccessFor` is the single place that turns an actor into a Pulse role (SPEC section 3).
 * A person's role is the first of these that applies:
 *   1. their explicit row in `pulse.member_roles` (plugs in here when the schema lands),
 *   2. their role in the org's own warehouse (WMS users, matched by email),
 *   3. their org role.
 * The same rule moves into `@kitstak/pulse-bridge` (`resolvePulseAccess`) so sibling apps share it.
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
  readonly source: 'system' | 'wms' | 'org';
}

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

const resolve = cache(async (orgId: string, userId: string, orgRole: OrgRole): Promise<PulseAccess> => {
  const fromWms = await wmsRole(orgId, userId);
  const role = fromWms ?? pulseRoleFromOrgRole(orgRole);
  return { role, seesMoney: canSeeMoney(role), seesWages: canSeeWages(role), source: fromWms ? 'wms' : 'org' };
});

export async function pulseAccessFor(ctx: DomainContext): Promise<PulseAccess> {
  if (ctx.actorKind !== 'user') return { role: 'owner', seesMoney: true, seesWages: true, source: 'system' };
  return resolve(ctx.orgId, ctx.userId, ctx.orgRole);
}

/** Throws FORBIDDEN unless the actor may perform `action`. Returns the resolved access. */
export async function requirePulse(ctx: DomainContext, action: PulseAction): Promise<PulseAccess> {
  const access = await pulseAccessFor(ctx);
  if (!canPulse(access.role, action)) {
    throw forbidden(
      access.role === 'none'
        ? 'You do not have access to KitStak Pulse yet. Ask an admin of your workspace to give you a role.'
        : 'Your Pulse role cannot do this. Ask an admin of your workspace if you need it.',
    );
  }
  return access;
}
