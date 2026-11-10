import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_PATH = path.join(DATA_DIR, "kitstak.db");

type DB = BetterSQLite3Database<typeof schema>;

declare global {
  var __kitstakDb: DB | undefined;
}

function createDb(): DB {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  // Wait for a concurrent writer instead of failing with SQLITE_BUSY (fulfillment-jobs R5-1).
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

/** Singleton across Next.js hot reloads. */
export const db: DB = globalThis.__kitstakDb ?? createDb();
if (process.env.NODE_ENV !== "production") {
  globalThis.__kitstakDb = db;
}

export { schema };
