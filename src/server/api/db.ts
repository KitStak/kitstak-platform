/**
 * Database handle types shared by the server platform.
 *
 * `AppDb` is satisfied by both the singleton database and a transaction (`tx`), so every
 * platform/domain function can take `(db | tx)` and tests can pass an in-memory database.
 */
import type { RunResult } from "better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "@/server/db/schema";

export type AppSchema = typeof schema;
export type AppDb = BaseSQLiteDatabase<"sync", RunResult, AppSchema>;

/**
 * Resolves the process-wide database lazily, so importing platform modules (e.g. in unit
 * tests) does not open `.data/kitstak.db` as a side effect.
 */
export async function getAppDb(): Promise<AppDb> {
  const mod = await import("@/server/db");
  return mod.db;
}
