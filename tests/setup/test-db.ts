/**
 * In-memory SQLite + Drizzle database for repository / domain tests.
 *
 * Applies the committed migrations in `drizzle/` so tests run against exactly
 * the schema production uses. Each call returns an isolated database.
 *
 *   const testDb = createTestDb();
 *   afterEach(() => testDb.close());
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/server/db/schema";

export const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

export type TestDatabase = BetterSQLite3Database<typeof schema>;

export interface TestDb {
  readonly db: TestDatabase;
  readonly sqlite: Database.Database;
  close(): void;
}

export function hasMigrations(dir: string = MIGRATIONS_DIR): boolean {
  return fs.existsSync(path.join(dir, "meta", "_journal.json"));
}

export function createTestDb(migrationsFolder: string = MIGRATIONS_DIR): TestDb {
  if (!hasMigrations(migrationsFolder)) {
    throw new Error(
      `No Drizzle migrations found in ${migrationsFolder}. Run "npm run db:generate" first.`
    );
  }
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}
