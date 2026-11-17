/**
 * Feature detection for sibling apps. Integration UI is shown only when (1) the org is entitled
 * to the module and (2) the sibling's tables exist in this database.
 *
 * WMS is one separate warehouse per organization: each org's WMS data lives in its own Postgres
 * schema (core.wms_tenants: the platform org keeps `wms`, every other org `wms_<org hex>`). WMS
 * reads always go through the request org's own schema (`wmsSchemaFor`); an org without an
 * active warehouse is treated as "WMS not installed" and never falls back to another org's data.
 * Every read here fails soft: on any error the integration reports "unavailable", never throws.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { findWmsTenantSchema, isWmsSchemaName } from '@kitstak/db/wms-tenants';
import { db } from '@/server/db';
import { orgModuleFlags } from '@/server/entitlements';
import type { DomainContext } from '@/server/domain/_shared';

const TABLE_TTL_MS = 5 * 60_000;
const tableCache = new Map<string, { exists: boolean; at: number }>();

export async function tableExists(qualified: string): Promise<boolean> {
  const cached = tableCache.get(qualified);
  if (cached && Date.now() - cached.at < TABLE_TTL_MS) return cached.exists;
  try {
    const result = await db.execute<{ exists: boolean }>(sql`select to_regclass(${qualified}) is not null as exists`);
    const exists = Boolean(result.rows[0]?.exists);
    tableCache.set(qualified, { exists, at: Date.now() });
    return exists;
  } catch {
    return false;
  }
}

/** Bare WMS table names are code constants; anything else is refused before it reaches SQL. */
const WMS_TABLE_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Whether `<schema>.<table>` exists. The schema must be a validated WMS schema name and the table
 * a plain lowercase identifier; the qualified name is sent as a bound parameter to to_regclass.
 */
export async function wmsTableExists(schemaName: string, table: string): Promise<boolean> {
  if (!isWmsSchemaName(schemaName) || !WMS_TABLE_RE.test(table)) return false;
  return tableExists(`"${schemaName}"."${table}"`);
}

const SCHEMA_TTL_MS = 60_000;
const schemaCache = new Map<string, { schema: string | null; at: number }>();

/**
 * The org's own ACTIVE WMS schema (validated), or null when it has no warehouse. Ignores module
 * entitlement (use `wmsSchemaFor` for integration reads). Fails soft.
 */
export async function wmsTenantSchemaFor(orgId: string): Promise<string | null> {
  const cached = schemaCache.get(orgId);
  if (cached && Date.now() - cached.at < SCHEMA_TTL_MS) return cached.schema;
  try {
    const found = await findWmsTenantSchema(db, orgId);
    // Only a usable warehouse counts: provisioned and migrated far enough to hold orders.
    const schema = found && (await wmsTableExists(found, 'shipment_orders')) ? found : null;
    if (schemaCache.size > 5000) schemaCache.clear();
    schemaCache.set(orgId, { schema, at: Date.now() });
    return schema;
  } catch {
    return null;
  }
}

/**
 * The WMS schema Pulse may read for this request's org: the WMS module is on AND the org has an
 * active warehouse. Null means "WMS not installed" for this org (never the platform schema).
 */
export async function wmsSchemaFor(ctx: DomainContext): Promise<string | null> {
  try {
    const flags = await orgModuleFlags(ctx.orgId);
    return flags.wms ? await wmsTenantSchemaFor(ctx.orgId) : null;
  } catch {
    return null;
  }
}

export interface IntegrationAvailability {
  readonly crm: boolean;
  readonly wms: boolean;
  readonly projects: boolean;
}

export async function integrationAvailability(ctx: DomainContext): Promise<IntegrationAvailability> {
  try {
    const flags = await orgModuleFlags(ctx.orgId);
    const [crmTables, wmsSchema, projectsTables] = await Promise.all([
      flags.crm ? tableExists('crm.items') : Promise.resolve(false),
      flags.wms ? wmsTenantSchemaFor(ctx.orgId) : Promise.resolve(null),
      flags.projects ? tableExists('pm.projects') : Promise.resolve(false),
    ]);
    return { crm: crmTables, wms: wmsSchema !== null, projects: projectsTables };
  } catch {
    return { crm: false, wms: false, projects: false };
  }
}
