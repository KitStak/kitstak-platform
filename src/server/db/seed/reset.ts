/**
 * Empties every table in place (keeps the schema and the Drizzle migration journal), so
 * `npm run db:seed` can run on its own against a database the dev server holds open.
 */
import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";

const KEEP_TABLES: ReadonlySet<string> = new Set(["__drizzle_migrations"]);

const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

export function listDataTables(db: AppDb): readonly string[] {
  return db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .map((r) => r.name)
    .filter((name) => !KEEP_TABLES.has(name));
}

/** Deletes all rows from every data table. Returns the number of tables emptied. */
export function wipeAllRows(db: AppDb): number {
  const tables = listDataTables(db);
  db.run(sql`PRAGMA foreign_keys = OFF`);
  try {
    db.transaction((tx) => {
      for (const table of tables) tx.run(sql.raw(`DELETE FROM ${quoteIdent(table)}`));
    });
  } finally {
    db.run(sql`PRAGMA foreign_keys = ON`);
  }
  return tables.length;
}
