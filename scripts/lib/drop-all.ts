/**
 * Drops every app object from a Postgres database (local PGlite or DATABASE_URL), including
 * Drizzle's migration journal (schema `drizzle`), so `db:migrate` rebuilds from scratch.
 *
 * Only objects in the `public` schema that the app created are dropped: views, tables (CASCADE
 * takes their indexes, triggers and constraints) and functions that do not belong to an
 * extension. Supabase-managed schemas (auth, storage, extensions, ...) are never touched.
 */
import { sql } from "drizzle-orm";
import type { AppDb } from "../../src/server/api/db";
import { dbAll, dbRun, withWriteTx } from "../../src/server/db/sql";

export type PgObjectType = "view" | "table" | "function" | "schema";

export interface PgObject {
  readonly type: PgObjectType;
  /** Quoted-ready name; functions include their argument list, e.g. `my_fn()`. */
  readonly name: string;
}

/** Drop order: dependents first. */
const DROP_ORDER: readonly PgObjectType[] = ["view", "table", "function", "schema"];

export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export async function listUserObjects(db: AppDb): Promise<readonly PgObject[]> {
  const views = await dbAll<{ name: string }>(db, sql`SELECT viewname AS name FROM pg_views WHERE schemaname = 'public' ORDER BY 1`);
  const tables = await dbAll<{ name: string }>(db, sql`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`);
  const functions = await dbAll<{ name: string; args: string }>(db, sql`
    SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    ORDER BY 1`);
  const journal = await dbAll<{ name: string }>(db, sql`SELECT nspname AS name FROM pg_namespace WHERE nspname = 'drizzle'`);
  return [
    ...views.map((v) => ({ type: "view" as const, name: v.name })),
    ...tables.map((t) => ({ type: "table" as const, name: t.name })),
    ...functions.map((f) => ({ type: "function" as const, name: `${f.name}(${f.args})` })),
    ...journal.map((s) => ({ type: "schema" as const, name: s.name })),
  ];
}

export function buildDropStatements(objects: readonly PgObject[]): readonly string[] {
  return DROP_ORDER.flatMap((type) =>
    objects
      .filter((o) => o.type === type)
      .map((o) => {
        if (type === "function") {
          const open = o.name.indexOf("(");
          return `DROP FUNCTION IF EXISTS "public".${quoteIdent(o.name.slice(0, open))}${o.name.slice(open)} CASCADE`;
        }
        if (type === "schema") return `DROP SCHEMA IF EXISTS ${quoteIdent(o.name)} CASCADE`;
        return `DROP ${type.toUpperCase()} IF EXISTS "public".${quoteIdent(o.name)} CASCADE`;
      }),
  );
}

/** Drops everything in one transaction (holding the app write lock) and returns the number of objects removed. */
export async function dropAllObjects(db: AppDb): Promise<number> {
  const objects = await listUserObjects(db);
  const statements = buildDropStatements(objects);
  await withWriteTx(db, async (tx) => {
    for (const statement of statements) await dbRun(tx, sql.raw(statement));
  });
  return objects.length;
}
