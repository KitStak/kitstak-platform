/**
 * `npx tsx scripts/seed-labor-history.ts`: idempotent labor-history backfill for the demo
 * database (M13). Adds a floor team, shares the seed's untimed jobs across it and records
 * real start scans on untimed completed tasks, so the labor analytics show measured work.
 * See src/server/repositories/analytics-labor-backfill.ts. Never rewrites a timed task.
 */
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/server/db/schema";
import type { AppDb } from "../src/server/api/db";
import { backfillLaborHistory } from "../src/server/repositories/analytics-labor-backfill";

const DB_PATH = process.env.KITSTAK_DB_PATH ?? path.join(process.cwd(), ".data", "kitstak.db");

function main(): void {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_PROD_SEED) {
    throw new Error("Refusing to write demo labor history in production. Set ALLOW_PROD_SEED=1 to override.");
  }
  const sqlite = new Database(DB_PATH, { fileMustExist: true });
  sqlite.pragma("busy_timeout = 10000");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as AppDb;
  try {
    const report = db.transaction((tx) => backfillLaborHistory(tx as unknown as AppDb));
    process.stdout.write(`labor history - ${JSON.stringify(report)}\n`);
  } finally {
    sqlite.close();
  }
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`Labor history backfill failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
