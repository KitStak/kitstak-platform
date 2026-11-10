/**
 * Drops every user object (tables, views, triggers, indexes) from a SQLite
 * database in-process, including Drizzle's migration journal table.
 *
 * Used by `npm run db:reset` instead of deleting `.data/kitstak.db*`: the dev
 * server keeps the file open (and on Windows a held file cannot be deleted),
 * but SQLite lets a second connection drop and recreate the schema safely.
 */
import type Database from "better-sqlite3";

export type SqliteObjectType = "table" | "view" | "trigger" | "index";

export interface SqliteObject {
  readonly type: SqliteObjectType;
  readonly name: string;
}

/** Drop order: dependents first, so no statement trips over a missing parent. */
const DROP_ORDER: readonly SqliteObjectType[] = ["trigger", "view", "index", "table"];

const DROP_KEYWORD: Readonly<Record<SqliteObjectType, string>> = {
  trigger: "TRIGGER",
  view: "VIEW",
  index: "INDEX",
  table: "TABLE",
};

export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function listUserObjects(sqlite: Database.Database): readonly SqliteObject[] {
  const rows = sqlite
    .prepare(
      `SELECT type, name FROM sqlite_master
       WHERE type IN ('table','view','trigger','index')
         AND name NOT LIKE 'sqlite_%'`
    )
    .all() as { type: SqliteObjectType; name: string }[];
  return rows.map((r) => ({ type: r.type, name: r.name }));
}

export function buildDropStatements(objects: readonly SqliteObject[]): readonly string[] {
  return DROP_ORDER.flatMap((type) =>
    objects
      .filter((o) => o.type === type)
      .map((o) => `DROP ${DROP_KEYWORD[type]} IF EXISTS ${quoteIdent(o.name)}`)
  );
}

/** Drops everything and returns the number of objects removed. */
export function dropAllObjects(sqlite: Database.Database): number {
  const objects = listUserObjects(sqlite);
  const statements = buildDropStatements(objects);
  const previousFk = sqlite.pragma("foreign_keys", { simple: true });
  sqlite.pragma("foreign_keys = OFF");
  try {
    sqlite.transaction(() => {
      for (const statement of statements) {
        sqlite.exec(statement);
      }
    })();
  } finally {
    sqlite.pragma(`foreign_keys = ${previousFk ? "ON" : "OFF"}`);
  }
  return objects.length;
}
