/**
 * Tenant migration stream: schema changes applied to EVERY org's WMS schema.
 *
 * The legacy `drizzle/` stream (0000-0012) only ever targets the platform `wms` schema — it
 * builds tables in `public` and moves them, and mixes in `core` DDL — so it is FROZEN for WMS
 * table changes. Any change to WMS tables from now on is an entry in `TENANT_MIGRATIONS`
 * below, written against the placeholder schema `__TENANT__`:
 *
 *     { name: '0001_orders_add_priority',
 *       sql: 'ALTER TABLE __TENANT__.shipment_orders ADD COLUMN priority integer' }
 *
 * `applyTenantMigrations` runs pending entries, in order, against `wms` first and then each
 * registered tenant schema, each entry in its own transaction, recording it in that schema's
 * `__tenant_migrations` ledger. New tenants are cloned from `wms` (already at head) and copy
 * its ledger, so they never replay history. Kept as code (not .sql files) so the serverless
 * bundle always carries it. Entries are append-only: never edit or reorder an applied one.
 *
 * Remember the Drizzle table definitions in `src/server/db/schema/*` too.
 *
 * Relative imports only (run from the tsx migration script).
 */
import { sql } from 'drizzle-orm';
import { assertWmsSchemaName, WMS_PLATFORM_SCHEMA } from '@kitstak/db/wms-tenants';
import type { AppDb } from '../api/db';
import { dbAll, dbRun } from '../db/sql';

export const TENANT_MIGRATIONS_TABLE = '__tenant_migrations';
export const TENANT_PLACEHOLDER = '__TENANT__';

export interface TenantMigration {
  /** `NNNN_description`, unique and sortable. */
  readonly name: string;
  /** Statements separated by `--> statement-breakpoint`; `__TENANT__` = the target schema. */
  readonly sql: string;
}

/** Append-only. See the module comment. */
export const TENANT_MIGRATIONS: readonly TenantMigration[] = [];

const BREAKPOINT = '--> statement-breakpoint';

export interface TenantMigrationResult {
  readonly schema: string;
  readonly applied: readonly string[];
}

/** Creates the per-schema ledger (idempotent). */
export async function ensureTenantLedger(db: AppDb, schemaName: string): Promise<void> {
  const schema = assertWmsSchemaName(schemaName);
  await dbRun(
    db,
    sql.raw(
      `CREATE TABLE IF NOT EXISTS "${schema}"."${TENANT_MIGRATIONS_TABLE}" (` +
        `"name" text PRIMARY KEY, "applied_at" timestamptz NOT NULL DEFAULT now())`,
    ),
  );
}

/** Renders one migration's statements for `schemaName`. */
export function renderTenantMigration(migration: TenantMigration, schemaName: string): string[] {
  const schema = `"${assertWmsSchemaName(schemaName)}"`;
  return migration.sql
    .split(BREAKPOINT)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => statement.replaceAll(TENANT_PLACEHOLDER, schema));
}

/** Applies pending tenant migrations to one schema (on the PLATFORM handle). */
export async function migrateTenantSchema(
  db: AppDb,
  schemaName: string,
  migrations: readonly TenantMigration[] = TENANT_MIGRATIONS,
): Promise<TenantMigrationResult> {
  const schema = assertWmsSchemaName(schemaName);
  await ensureTenantLedger(db, schema);
  const done = new Set(
    (
      await dbAll<{ name: string }>(
        db,
        sql.raw(`SELECT "name" FROM "${schema}"."${TENANT_MIGRATIONS_TABLE}"`),
      )
    ).map((r) => r.name),
  );
  const applied: string[] = [];
  for (const migration of migrations) {
    if (done.has(migration.name)) continue;
    await db.transaction(async (tx) => {
      for (const statement of renderTenantMigration(migration, schema)) await dbRun(tx, sql.raw(statement));
      await dbRun(
        tx,
        sql`INSERT INTO ${sql.identifier(schema)}.${sql.identifier(TENANT_MIGRATIONS_TABLE)} ("name") VALUES (${migration.name})`,
      );
    });
    applied.push(migration.name);
  }
  return { schema, applied };
}

/**
 * `wms` first, then every registered tenant schema that exists (migrations: any status, so a
 * half-provisioned schema still stays at head) or only `active` ones (`activeOnly`: scheduler).
 */
export async function listTenantSchemas(
  db: AppDb,
  options: { readonly activeOnly?: boolean } = {},
): Promise<string[]> {
  const exists = await dbAll<{ ok: boolean }>(db, sql`SELECT to_regclass('core.wms_tenants') IS NOT NULL AS ok`);
  const rows = exists[0]?.ok
    ? await dbAll<{ schema: string }>(
        db,
        sql`SELECT schema_name AS schema FROM core.wms_tenants WHERE schema_name <> ${WMS_PLATFORM_SCHEMA}
            AND to_regnamespace(schema_name) IS NOT NULL
            AND (${options.activeOnly === true} = false OR status = 'active') ORDER BY created_at`,
      )
    : [];
  return [WMS_PLATFORM_SCHEMA, ...rows.map((r) => assertWmsSchemaName(r.schema))];
}

/** Brings `wms` and every tenant schema to the head of the tenant stream. */
export async function applyTenantMigrations(
  db: AppDb,
  migrations: readonly TenantMigration[] = TENANT_MIGRATIONS,
): Promise<TenantMigrationResult[]> {
  const results: TenantMigrationResult[] = [];
  for (const schema of await listTenantSchemas(db)) results.push(await migrateTenantSchema(db, schema, migrations));
  return results;
}
