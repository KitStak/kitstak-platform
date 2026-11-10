/**
 * `npm run db:fixtures`: idempotent Logiwa acceptance fixtures for MLT1
 * (src/server/db/seed/acceptance-fixtures.ts). Safe on the live database; never wipes anything.
 * Also chained after `db:seed` in `db:reset`.
 */
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/server/db/schema";
import { seedAcceptanceFixtures } from "../src/server/db/seed/acceptance-fixtures";
import { systemCtx } from "../src/server/domain/types";
import type { AppDb } from "../src/server/api/db";

const DB_PATH = process.env.KITSTAK_DB_PATH ?? path.join(process.cwd(), ".data", "kitstak.db");

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function main(): void {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_PROD_SEED) {
    throw new Error("Refusing to write demo fixtures in production. Set ALLOW_PROD_SEED=1 to override.");
  }
  const sqlite = new Database(DB_PATH, { fileMustExist: true });
  sqlite.pragma("busy_timeout = 10000");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as AppDb;
  try {
    const report = db.transaction((tx) => seedAcceptanceFixtures(tx, systemCtx("Seed")));
    out(`db:fixtures - ${report.created.length} created, ${report.skipped.length} already present`);
    for (const line of report.created) out(`  + ${line}`);
  } finally {
    sqlite.close();
  }
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`Fixtures failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
