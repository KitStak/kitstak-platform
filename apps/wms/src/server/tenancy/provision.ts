/**
 * Creates an organization's own WMS warehouse (one separate warehouse per organization).
 *
 *  1. checks: the caller is an owner/admin member of the org, the org holds the `wms`
 *     entitlement, and it has no warehouse yet;
 *  2. platform transaction: registers `wms_<org hex>` in core.wms_tenants as `provisioning`
 *     and clones the structure of the platform `wms` schema into it (no data);
 *  3. tenant transaction: seeds the starter data (starter-seed.ts) — the caller becomes the
 *     warehouse's first administrator;
 *  4. marks the registry row `active`.
 *
 * If 3 or 4 fails the schema is dropped and the registry row removed, so a retry starts
 * clean. A `provisioning` row older than STALE_MS (a crashed attempt) is cleaned up the same
 * way; a younger one means another attempt is running (BUSY).
 */
import { and, eq, sql } from 'drizzle-orm';
import { member, organization, user, wmsTenants } from '@kitstak/db/schema';
import { assertWmsSchemaName, wmsSchemaNameForOrg } from '@kitstak/db/wms-tenants';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import { wmsModuleEntitledForOrg } from '@/server/auth/entitlements';
import { assertWarehouseAvailable } from '@/server/auth/plan';
import { dbRun, withWriteTx } from '@/server/db/sql';
import { log } from '@/server/log';
import { cloneWmsSchema, type CloneReport } from './clone-schema';
import { isSetupRole } from './registry';
import { seedStarterWarehouse, type FirstWarehouseInput } from './starter-seed';

/** A `provisioning` row older than this is a crashed attempt and may be cleaned up. */
export const STALE_MS = 10 * 60_000;

export interface ProvisionInput {
  readonly orgId: string;
  readonly userId: string;
  readonly warehouse: FirstWarehouseInput;
}

export interface ProvisionResult {
  readonly schemaName: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly clone: CloneReport;
  readonly ms: number;
}

export interface ProvisionDeps {
  /** The tenant handle for a freshly cloned schema (production: `getTenantDb`). */
  readonly tenantDb: (schemaName: string) => Promise<AppDb>;
  readonly now?: () => Date;
}

/**
 * Drops a `provisioning` tenant and its schema — only the exact attempt identified by
 * `createdAt`, so a concurrent cleanup can never remove a newer attempt's row mid-seed.
 * Returns false when that row is already gone (someone else cleaned up).
 */
async function dropTenant(platformDb: AppDb, orgId: string, schemaName: string, createdAt: Date): Promise<boolean> {
  const schema = assertWmsSchemaName(schemaName);
  if (schema === 'wms') throw new Error('Refusing to drop the platform schema');
  return await platformDb.transaction(async (tx) => {
    const removed = await tx
      .delete(wmsTenants)
      .where(
        and(eq(wmsTenants.orgId, orgId), eq(wmsTenants.status, 'provisioning'), eq(wmsTenants.createdAt, createdAt)),
      )
      .returning({ orgId: wmsTenants.orgId });
    if (removed.length === 0) return false;
    await dbRun(tx, sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
    return true;
  });
}

async function loadCaller(platformDb: AppDb, orgId: string, userId: string) {
  const row = (
    await platformDb
      .select({
        orgName: organization.name,
        role: member.role,
        email: user.email,
        name: user.name,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
      .limit(1)
  )[0];
  // Non-members get NOT_FOUND (no probing org ids); members without the role, FORBIDDEN.
  if (!row) throw new AppError('NOT_FOUND', 'Organization not found');
  if (!isSetupRole(row.role))
    throw new AppError('FORBIDDEN', 'Only an owner or admin of the organization can set up its warehouse');
  return row;
}

/** Provisions the org's warehouse; see the module comment. `platformDb` = the platform handle. */
export async function provisionWarehouse(
  platformDb: AppDb,
  deps: ProvisionDeps,
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const started = Date.now();
  const now = deps.now ?? (() => new Date());
  const caller = await loadCaller(platformDb, input.orgId, input.userId);
  if (!(await wmsModuleEntitledForOrg(platformDb, input.orgId))) {
    throw new AppError('ENTITLEMENT_MISSING', 'WMS is not in your plan yet. Add it in the Portal to use it.', {
      details: { module: 'wms' },
    });
  }
  // The first warehouse of a paid plan counts toward the plan's warehouse limit (always covered:
  // a plan with WMS pays for at least one). No limit during a free trial.
  await assertWarehouseAvailable(platformDb, input.orgId, 1);

  const schemaName = wmsSchemaNameForOrg(input.orgId);
  const existing = (
    await platformDb.select().from(wmsTenants).where(eq(wmsTenants.orgId, input.orgId)).limit(1)
  )[0];
  if (existing?.status === 'active') throw new AppError('INVALID_STATE', 'This organization already has a warehouse');
  if (existing) {
    if (now().getTime() - existing.createdAt.getTime() < STALE_MS) {
      throw new AppError('BUSY', 'The warehouse is already being set up. Try again in a minute.', {
        headers: { 'Retry-After': '30' },
      });
    }
    log.warn('cleaning up a stale warehouse provisioning', { orgId: input.orgId, schema: existing.schemaName });
    if (!(await dropTenant(platformDb, input.orgId, existing.schemaName, existing.createdAt))) {
      throw new AppError('BUSY', 'The warehouse is already being set up. Try again in a minute.');
    }
  }

  // 2. Register + clone in one platform transaction (DDL is transactional in Postgres).
  let clone: CloneReport;
  const attemptAt = now();
  try {
    clone = await platformDb.transaction(async (tx) => {
      await tx.insert(wmsTenants).values({ orgId: input.orgId, schemaName, status: 'provisioning', createdAt: attemptAt });
      return await cloneWmsSchema(tx, schemaName);
    });
  } catch (error: unknown) {
    // A concurrent attempt won the registry insert (PK): report it as busy, not a crash.
    if ((error as { code?: string; cause?: { code?: string } }).code === '23505' ||
        (error as { cause?: { code?: string } }).cause?.code === '23505') {
      throw new AppError('BUSY', 'The warehouse is already being set up. Try again in a minute.');
    }
    throw error;
  }

  // 3 + 4. Starter data on the new tenant, then activate. Any failure: drop and unregister.
  try {
    const tenant = await deps.tenantDb(schemaName);
    const seeded = await withWriteTx(tenant, async (tx) =>
      await seedStarterWarehouse(tx, {
        orgId: input.orgId,
        orgName: caller.orgName,
        schemaName,
        admin: { userId: input.userId, email: caller.email, name: caller.name },
        warehouse: input.warehouse,
      }),
    );
    await platformDb
      .update(wmsTenants)
      .set({ status: 'active', provisionedAt: now(), provisionedBy: input.userId })
      .where(eq(wmsTenants.orgId, input.orgId));
    const result = { schemaName, ...seeded, clone, ms: Date.now() - started };
    log.info('warehouse provisioned', { orgId: input.orgId, schema: schemaName, ms: result.ms });
    return result;
  } catch (error: unknown) {
    log.error('warehouse provisioning failed; rolling back', { orgId: input.orgId, schema: schemaName, err: error });
    try {
      await dropTenant(platformDb, input.orgId, schemaName, attemptAt);
    } catch (cleanupError: unknown) {
      log.error('warehouse provisioning cleanup failed', { orgId: input.orgId, err: cleanupError });
    }
    throw error;
  }
}
