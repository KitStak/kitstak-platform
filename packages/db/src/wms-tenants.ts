/**
 * WMS tenant schema naming + lookup, shared by every app that reads WMS data
 * (WMS itself, portal onboarding/product stats, CRM's WMS link, Projects).
 *
 * One separate warehouse per organization: each org's WMS data lives in its own Postgres
 * schema, recorded in core.wms_tenants. The platform org keeps `wms`; every other org gets
 * `wms_<32 hex of the org uuid>`. Schema names are validated against a strict pattern
 * before they are ever interpolated into SQL as identifiers.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { wmsTenants } from './schema/core/wms-tenants';

/** The platform organization's (original) WMS schema. */
export const WMS_PLATFORM_SCHEMA = 'wms';

const SCHEMA_NAME_RE = /^wms(_[0-9a-f]{32})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for `wms` or `wms_<32 lowercase hex>` — the only names ever used as identifiers. */
export function isWmsSchemaName(name: string): boolean {
  return SCHEMA_NAME_RE.test(name);
}

/** The schema a newly provisioned (non-platform) org gets: `wms_<org uuid hex>`. */
export function wmsSchemaNameForOrg(orgId: string): string {
  if (!UUID_RE.test(orgId)) throw new Error(`Not an organization id: ${orgId}`);
  return `wms_${orgId.replace(/-/g, '').toLowerCase()}`;
}

/** Throws unless `name` is a valid WMS schema name; returns it for chaining. */
export function assertWmsSchemaName(name: string): string {
  if (!isWmsSchemaName(name)) throw new Error(`Invalid WMS schema name: ${JSON.stringify(name)}`);
  return name;
}

// Any drizzle Postgres database (node-postgres in CRM/portal, postgres-js/PGlite in WMS).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPgDb = PgDatabase<PgQueryResultHKT, any>;

/**
 * The ACTIVE WMS schema of an organization, or null when the org has no warehouse yet
 * (never provisioned, or provisioning has not finished). The result is validated.
 */
export async function findWmsTenantSchema(db: AnyPgDb, orgId: string): Promise<string | null> {
  if (!UUID_RE.test(orgId)) return null;
  const rows = await db
    .select({ schemaName: wmsTenants.schemaName })
    .from(wmsTenants)
    .where(and(eq(wmsTenants.orgId, orgId), eq(wmsTenants.status, 'active')))
    .limit(1);
  const name = rows[0]?.schemaName;
  return name && isWmsSchemaName(name) ? name : null;
}

/** `"<schema>"."<table>"` as a drizzle SQL identifier chunk, after validating the schema. */
export function wmsTable(schemaName: string, table: string) {
  return sql`${sql.identifier(assertWmsSchemaName(schemaName))}.${sql.identifier(table)}`;
}
