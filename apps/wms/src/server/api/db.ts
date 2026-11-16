/**
 * Database handle types and accessors shared by the server platform.
 *
 * `AppDb` is satisfied by the platform database (postgres-js in production, PGlite locally
 * and in tests), by a tenant-scoped handle (src/server/db/tenant.ts) AND by a transaction
 * (`tx`), so every platform/domain function can take `(db | tx)` and tests can pass an
 * in-memory PGlite database. Every query is async: `await q` (rows), `(await q.limit(1))[0]`
 * (one row); raw SQL goes through `dbAll / dbGet / dbRun` in `@/server/db/sql`.
 *
 * One separate warehouse per organization:
 * - `getAppDb()`      → the CURRENT REQUEST's warehouse (the signed-in user's org schema);
 *                        the platform handle outside a request or before sign-in.
 * - `getPlatformDb()` → the platform handle: core tables (sessions, orgs, entitlements) and
 *                        the platform org's `wms` schema. Auth internals and scripts only.
 * - `getTenantDbFor(schema)` → one org's warehouse (scheduler, provisioning).
 */
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type * as schema from '@/server/db/schema';

export type AppSchema = typeof schema;

/** A database or an open transaction (transactions extend the database type). */
export type AppDb = PgDatabase<PgQueryResultHKT, AppSchema>;

/** An open transaction (what `db.transaction(async (tx) => ...)` hands its callback). */
export type AppTx = PgTransaction<PgQueryResultHKT, AppSchema, ExtractTablesWithRelations<AppSchema>>;

/**
 * The platform database, resolved lazily so importing platform modules (e.g. in unit tests)
 * does not open a connection as a side effect. The first call also applies pending
 * migrations to the local PGlite database (never to DATABASE_URL).
 */
export async function getPlatformDb(): Promise<AppDb> {
  const mod = await import('@/server/db');
  return await mod.getDb();
}

/** One organization's warehouse handle (`schemaName` from core.wms_tenants). */
export async function getTenantDbFor(schemaName: string): Promise<AppDb> {
  const mod = await import('@/server/db');
  return await mod.getTenantDb(schemaName);
}

/**
 * The current request's warehouse handle (see the module comment). Fails CLOSED in
 * production when called outside any request: background work must pass the tenant handle
 * it was given (scheduler tasks, `after()` callbacks) — an ambient fallback to the platform
 * schema would write one org's work into another org's warehouse. Dev scripts and tests
 * keep the platform fallback.
 */
export async function getAppDb(): Promise<AppDb> {
  const { currentTenantSchema, inRequestScope } = await import('@/server/tenancy/request');
  const schemaName = await currentTenantSchema();
  if (schemaName) return await getTenantDbFor(schemaName);
  if (process.env.NODE_ENV === 'production' && !(await inRequestScope())) {
    throw new Error('getAppDb() was called outside a request: pass the warehouse handle explicitly');
  }
  return await getPlatformDb();
}
