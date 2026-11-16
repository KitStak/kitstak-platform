/**
 * Organization ↔ WMS schema registry (core.wms_tenants) and per-user org choices.
 *
 * One separate warehouse per organization: a signed-in user works in exactly one org's WMS
 * at a time — the org picked by the `kitstak.wms_org` cookie (header org switcher), else the
 * Better Auth active organization, else the platform org, else their first org. Only orgs
 * the user is a MEMBER of, that hold the `wms` entitlement and whose warehouse is provisioned
 * are selectable; an entitled org without a warehouse is offered for setup to its owners/admins.
 */
import { asc, eq, sql } from 'drizzle-orm';
import { member, organization, wmsTenants } from '@kitstak/db/schema';
import { assertWmsSchemaName, isWmsSchemaName, WMS_PLATFORM_SCHEMA } from '@kitstak/db/wms-tenants';
import type { AppDb } from '@/server/api/db';
import { wmsModuleEntitledForOrg } from '@/server/auth/entitlements';
import { dbGet } from '@/server/db/sql';
import { currentWmsSchema } from '@/server/db/tenant';

/** Cookie holding the org id the user last picked in the WMS org switcher. */
export const WMS_ORG_COOKIE = 'kitstak.wms_org';

/** The platform org (mirrors PLATFORM_ORG_SLUG in auth/credentials; no import cycle). */
const PLATFORM_ORG_SLUG = 'kitstak';

/** Org roles allowed to set up an org's warehouse. */
const SETUP_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

export interface WmsOrgChoice {
  readonly orgId: string;
  readonly name: string;
  readonly slug: string;
  /** The user's core.member role(s), comma-separated as Better Auth stores them. */
  readonly memberRole: string;
  /** Active warehouse schema, or null when the org has no warehouse yet. */
  readonly schemaName: string | null;
  readonly entitled: boolean;
}

export const isSetupRole = (memberRole: string): boolean =>
  memberRole.split(',').some((r) => SETUP_ROLES.has(r.trim()));

/** Every org the user belongs to, with its warehouse schema and WMS entitlement. */
export async function listWmsOrgs(platformDb: AppDb, userId: string): Promise<WmsOrgChoice[]> {
  const rows = await platformDb
    .select({
      orgId: organization.id,
      name: organization.name,
      slug: organization.slug,
      memberRole: member.role,
      schemaName: wmsTenants.schemaName,
      status: wmsTenants.status,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .leftJoin(wmsTenants, eq(wmsTenants.orgId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));
  const choices: WmsOrgChoice[] = [];
  for (const r of rows) {
    // The platform org owns `wms` even before its registry row exists (fresh dev/test DBs).
    const registered =
      r.status === 'active' && r.schemaName && isWmsSchemaName(r.schemaName) ? r.schemaName : null;
    const schemaName = registered ?? (r.slug === PLATFORM_ORG_SLUG && !r.status ? WMS_PLATFORM_SCHEMA : null);
    choices.push({
      orgId: r.orgId,
      name: r.name,
      slug: r.slug,
      memberRole: r.memberRole,
      schemaName,
      entitled: await wmsModuleEntitledForOrg(platformDb, r.orgId),
    });
  }
  return choices;
}

/** Orgs whose warehouse the user can open right now. */
export const openableOrgs = (choices: readonly WmsOrgChoice[]): WmsOrgChoice[] =>
  choices.filter((c) => c.entitled && c.schemaName !== null);

/**
 * Orgs in the order a request should try them: cookie pick, then active org, then the
 * platform org, then membership order — openable orgs first, then provisioned but
 * unentitled ones (the entitlement gate then shows the locked page, not "no warehouse").
 * Session resolution walks this list until the user has an active profile in one.
 */
export function rankWmsOrgs(
  choices: readonly WmsOrgChoice[],
  prefs: { readonly cookieOrgId?: string | null; readonly activeOrgId?: string | null },
): WmsOrgChoice[] {
  const rank = (pool: readonly WmsOrgChoice[]): WmsOrgChoice[] => {
    const score = (c: WmsOrgChoice): number =>
      c.orgId === prefs.cookieOrgId ? 0 : c.orgId === prefs.activeOrgId ? 1 : c.schemaName === WMS_PLATFORM_SCHEMA ? 2 : 3;
    return [...pool].sort((a, b) => score(a) - score(b)); // stable: membership order within a tier
  };
  const open = openableOrgs(choices);
  const locked = choices.filter((c) => c.schemaName !== null && !open.includes(c));
  return [...rank(open), ...rank(locked)];
}

/** The first org `rankWmsOrgs` would try, or null. */
export function pickWmsOrg(
  choices: readonly WmsOrgChoice[],
  prefs: { readonly cookieOrgId?: string | null; readonly activeOrgId?: string | null },
): WmsOrgChoice | null {
  return rankWmsOrgs(choices, prefs)[0] ?? null;
}

/** Entitled orgs without a warehouse that this user may set up (org owner/admin). */
export const setupCandidates = (choices: readonly WmsOrgChoice[]): WmsOrgChoice[] =>
  choices.filter((c) => c.entitled && c.schemaName === null && isSetupRole(c.memberRole));

/** Records the platform org as the owner of the original `wms` schema (idempotent). */
export async function registerPlatformTenant(db: AppDb, orgId: string): Promise<void> {
  await db
    .insert(wmsTenants)
    .values({ orgId, schemaName: WMS_PLATFORM_SCHEMA, status: 'active', provisionedAt: new Date() })
    .onConflictDoNothing();
}

/**
 * The organization that owns a handle's warehouse: the registry row for its schema (any
 * status — provisioning seeds run before activation). Null when the schema is not registered
 * (the platform schema before its org exists).
 */
export async function orgIdForDb(db: AppDb): Promise<string | null> {
  const schemaName = assertWmsSchemaName(await currentWmsSchema(db));
  const exists = await dbGet<{ ok: boolean }>(db, sql`SELECT to_regclass('core.wms_tenants') IS NOT NULL AS ok`);
  if (!exists?.ok) return null;
  const row = (
    await db
      .select({ orgId: wmsTenants.orgId })
      .from(wmsTenants)
      .where(eq(wmsTenants.schemaName, schemaName))
      .limit(1)
  )[0];
  return row?.orgId ?? null;
}
