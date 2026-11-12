/**
 * Drops every app object from a Postgres database (local PGlite or DATABASE_URL), including
 * Drizzle's migration journal (schema `drizzle`) and the `wms` schema the app tables live in
 * (migration 0006), so `db:migrate` rebuilds from scratch.
 *
 * Only objects the app created are dropped: views, tables (CASCADE takes their indexes,
 * triggers and constraints) and functions that do not belong to an extension, in the `public`
 * and `wms` schemas. Supabase-managed schemas (auth, storage, extensions, ...) and the shared
 * platform schemas (`core`, `crm` — owned by packages/db migrations) are never touched.
 */
import { sql } from 'drizzle-orm';
import type { AppDb } from '../../src/server/api/db';
import { dbAll, dbRun, withWriteTx } from '../../src/server/db/sql';

export type PgObjectType = 'view' | 'table' | 'function' | 'schema';

export interface PgObject {
  readonly type: PgObjectType;
  /** Schema the object lives in; '' for schema objects themselves. */
  readonly schema: string;
  /** Quoted-ready name; functions include their argument list, e.g. `my_fn()`. */
  readonly name: string;
}

/** Drop order: dependents first. */
const DROP_ORDER: readonly PgObjectType[] = ['view', 'table', 'function', 'schema'];

export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export async function listUserObjects(db: AppDb): Promise<readonly PgObject[]> {
  const views = await dbAll<{ schema: string; name: string }>(
    db,
    sql`SELECT schemaname AS schema, viewname AS name FROM pg_views WHERE schemaname IN ('public', 'wms') ORDER BY 1, 2`,
  );
  const tables = await dbAll<{ schema: string; name: string }>(
    db,
    sql`SELECT schemaname AS schema, tablename AS name FROM pg_tables WHERE schemaname IN ('public', 'wms') ORDER BY 1, 2`,
  );
  const functions = await dbAll<{ schema: string; name: string; args: string }>(
    db,
    sql`
    SELECT n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'wms')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    ORDER BY 1, 2`,
  );
  const schemas = await dbAll<{ name: string }>(
    db,
    sql`SELECT nspname AS name FROM pg_namespace WHERE nspname IN ('drizzle', 'wms') ORDER BY 1`,
  );
  return [
    ...views.map((v) => ({ type: 'view' as const, schema: v.schema, name: v.name })),
    ...tables.map((t) => ({ type: 'table' as const, schema: t.schema, name: t.name })),
    ...functions.map((f) => ({
      type: 'function' as const,
      schema: f.schema,
      name: `${f.name}(${f.args})`,
    })),
    ...schemas.map((s) => ({ type: 'schema' as const, schema: '', name: s.name })),
  ];
}

export function buildDropStatements(objects: readonly PgObject[]): readonly string[] {
  return DROP_ORDER.flatMap((type) =>
    objects
      .filter((o) => o.type === type)
      .map((o) => {
        if (type === 'function') {
          const open = o.name.indexOf('(');
          return `DROP FUNCTION IF EXISTS ${quoteIdent(o.schema)}.${quoteIdent(o.name.slice(0, open))}${o.name.slice(open)} CASCADE`;
        }
        if (type === 'schema') return `DROP SCHEMA IF EXISTS ${quoteIdent(o.name)} CASCADE`;
        return `DROP ${type.toUpperCase()} IF EXISTS ${quoteIdent(o.schema)}.${quoteIdent(o.name)} CASCADE`;
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
