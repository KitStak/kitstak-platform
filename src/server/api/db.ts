/**
 * Database handle types shared by the server platform.
 *
 * `AppDb` is satisfied by the singleton database (postgres-js in production, PGlite locally
 * and in tests) AND by a transaction (`tx`), so every platform/domain function can take
 * `(db | tx)` and tests can pass an in-memory PGlite database. Every query is async:
 * `await q` (rows), `(await q.limit(1))[0]` (one row); raw SQL goes through
 * `dbAll / dbGet / dbRun` in `@/server/db/sql` (see docs/POSTGRES_MIGRATION.md).
 */
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type * as schema from "@/server/db/schema";

export type AppSchema = typeof schema;

/** A database or an open transaction (transactions extend the database type). */
export type AppDb = PgDatabase<PgQueryResultHKT, AppSchema>;

/** An open transaction (what `db.transaction(async (tx) => ...)` hands its callback). */
export type AppTx = PgTransaction<PgQueryResultHKT, AppSchema, ExtractTablesWithRelations<AppSchema>>;

/**
 * Resolves the process-wide database lazily, so importing platform modules (e.g. in unit
 * tests) does not open a connection as a side effect. The first call also applies pending
 * migrations to the local PGlite database (never to DATABASE_URL).
 */
export async function getAppDb(): Promise<AppDb> {
  const mod = await import("@/server/db");
  return await mod.getDb();
}
