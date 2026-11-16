/**
 * Structural clone of the platform `wms` schema into a new, EMPTY tenant schema.
 *
 * The platform schema is always at migration head (legacy `drizzle/` stream + the tenant
 * stream in `drizzle-tenant/`), so a new org's warehouse is built by copying its structure
 * from the live catalog rather than replaying migrations — the legacy stream builds tables
 * in `public` and then moves them, which cannot be retargeted safely. Copied, in order:
 *
 *  1. tables — `CREATE TABLE … (LIKE wms.t INCLUDING ALL EXCLUDING INDEXES)`: columns,
 *     defaults, NOT NULL, CHECK constraints, identity / generated columns, comments; a column
 *     default on a `wms` sequence gets its own sequence in the tenant; then PK / unique
 *     constraints and indexes under their original names;
 *  2. functions (trigger functions such as `billing_reports_period_guard`), bodies retargeted;
 *  3. foreign keys (`pg_get_constraintdef`, retargeted; FKs into `core` are kept as is);
 *  4. triggers, 5. views, 6. row-level security flags and policies.
 *
 * No data is copied except the tenant-migration ledger (the clone is at the same head).
 * Every catalog definition is printed with `search_path = pg_catalog`, so every `wms` object
 * is schema-qualified and `rewriteTenantSql` retargets it. Runs in the caller's transaction.
 */
import { sql } from 'drizzle-orm';
import { assertWmsSchemaName, WMS_PLATFORM_SCHEMA } from '@kitstak/db/wms-tenants';
import type { AppDb } from '@/server/api/db';
import { dbAll, dbRun } from '@/server/db/sql';
import { rewriteTenantSql } from '@/server/db/tenant';
import { ensureTenantLedger, TENANT_MIGRATIONS_TABLE } from './migrations';

const SOURCE = WMS_PLATFORM_SCHEMA;

export interface CloneReport {
  readonly tables: number;
  readonly functions: number;
  readonly foreignKeys: number;
  readonly triggers: number;
  readonly views: number;
  readonly policies: number;
}

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

async function exec(db: AppDb, statement: string): Promise<void> {
  await dbRun(db, sql.raw(statement));
}

async function cloneTables(db: AppDb, target: string): Promise<number> {
  const tables = await dbAll<{ name: string }>(
    db,
    sql`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ${SOURCE} AND c.relkind IN ('r', 'p') ORDER BY c.relname`,
  );
  for (const { name } of tables) {
    await exec(db, `CREATE TABLE ${ident(target)}.${ident(name)} (LIKE ${ident(SOURCE)}.${ident(name)} INCLUDING ALL EXCLUDING INDEXES)`);
  }
  // Serial-style defaults would still draw from the platform's sequence: give each its own.
  const serials = await dbAll<{ tbl: string; col: string; def: string }>(
    db,
    sql`SELECT c.relname AS tbl, a.attname AS col, pg_get_expr(d.adbin, d.adrelid) AS def
        FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
        WHERE n.nspname = ${target} AND pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%'`,
  );
  for (const s of serials) {
    const seq = `${s.tbl}_${s.col}_seq`;
    await exec(db, `CREATE SEQUENCE IF NOT EXISTS ${ident(target)}.${ident(seq)}`);
    await exec(
      db,
      `ALTER TABLE ${ident(target)}.${ident(s.tbl)} ALTER COLUMN ${ident(s.col)} SET DEFAULT nextval('${target}.${seq.replace(/'/g, "''")}'::regclass)`,
    );
    await exec(db, `ALTER SEQUENCE ${ident(target)}.${ident(seq)} OWNED BY ${ident(target)}.${ident(s.tbl)}.${ident(s.col)}`);
  }
  return tables.length;
}

/**
 * Primary-key / unique / exclusion constraints and every other index, under their ORIGINAL
 * names (LIKE … INCLUDING INDEXES would invent new ones, and error handling matches names).
 */
async function cloneIndexes(db: AppDb, target: string): Promise<number> {
  const keys = await dbAll<{ tbl: string; name: string; def: string }>(
    db,
    sql`SELECT c.relname AS tbl, k.conname AS name, pg_get_constraintdef(k.oid) AS def
        FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ${SOURCE} AND k.contype IN ('p', 'u', 'x') ORDER BY c.relname, k.conname`,
  );
  for (const k of keys) {
    await exec(
      db,
      `ALTER TABLE ${ident(target)}.${ident(k.tbl)} ADD CONSTRAINT ${ident(k.name)} ${rewriteTenantSql(k.def, target)}`,
    );
  }
  const indexes = await dbAll<{ def: string }>(
    db,
    sql`SELECT pg_get_indexdef(i.indexrelid) AS def FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ${SOURCE}
          AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid AND k.contype IN ('p', 'u', 'x'))`,
  );
  for (const { def } of indexes) await exec(db, rewriteTenantSql(def, target));
  return keys.length + indexes.length;
}

async function cloneFunctions(db: AppDb, target: string): Promise<number> {
  const fns = await dbAll<{ def: string }>(
    db,
    sql`SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = ${SOURCE} AND p.prokind = 'f'`,
  );
  for (const { def } of fns) await exec(db, rewriteTenantSql(def, target));
  return fns.length;
}

async function cloneForeignKeys(db: AppDb, target: string): Promise<number> {
  const fks = await dbAll<{ tbl: string; name: string; def: string }>(
    db,
    sql`SELECT c.relname AS tbl, k.conname AS name, pg_get_constraintdef(k.oid) AS def
        FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ${SOURCE} AND k.contype = 'f' ORDER BY c.relname, k.conname`,
  );
  for (const fk of fks) {
    await exec(
      db,
      `ALTER TABLE ${ident(target)}.${ident(fk.tbl)} ADD CONSTRAINT ${ident(fk.name)} ${rewriteTenantSql(fk.def, target)}`,
    );
  }
  return fks.length;
}

async function cloneTriggers(db: AppDb, target: string): Promise<number> {
  const triggers = await dbAll<{ def: string }>(
    db,
    sql`SELECT pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ${SOURCE} AND NOT t.tgisinternal`,
  );
  for (const { def } of triggers) await exec(db, rewriteTenantSql(def, target));
  return triggers.length;
}

async function cloneViews(db: AppDb, target: string): Promise<number> {
  const views = await dbAll<{ name: string; def: string }>(
    db,
    sql`SELECT c.relname AS name, pg_get_viewdef(c.oid) AS def FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${SOURCE} AND c.relkind = 'v'`,
  );
  for (const v of views) {
    await exec(db, `CREATE VIEW ${ident(target)}.${ident(v.name)} AS ${rewriteTenantSql(v.def, target)}`);
  }
  return views.length;
}

async function cloneRowSecurity(db: AppDb, target: string): Promise<number> {
  const flags = await dbAll<{ name: string; rls: boolean; force: boolean }>(
    db,
    sql`SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS force FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ${SOURCE} AND c.relkind IN ('r', 'p') AND (c.relrowsecurity OR c.relforcerowsecurity)`,
  );
  for (const f of flags) {
    const table = `${ident(target)}.${ident(f.name)}`;
    if (f.rls) await exec(db, `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    if (f.force) await exec(db, `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
  }
  const policies = await dbAll<{
    tbl: string;
    name: string;
    permissive: string;
    cmd: string;
    roles: string[] | string;
    qual: string | null;
    check: string | null;
  }>(
    db,
    sql`SELECT tablename AS tbl, policyname AS name, permissive, cmd, roles, qual, with_check AS "check"
        FROM pg_policies WHERE schemaname = ${SOURCE}`,
  );
  for (const p of policies) {
    const roles = (Array.isArray(p.roles) ? p.roles : String(p.roles).replace(/[{}]/g, '').split(','))
      .filter(Boolean)
      .map((r) => (r === 'public' ? 'PUBLIC' : ident(r)))
      .join(', ');
    const parts = [
      `CREATE POLICY ${ident(p.name)} ON ${ident(target)}.${ident(p.tbl)}`,
      `AS ${p.permissive === 'RESTRICTIVE' ? 'RESTRICTIVE' : 'PERMISSIVE'}`,
      `FOR ${p.cmd}`,
      roles ? `TO ${roles}` : '',
      p.qual ? `USING (${rewriteTenantSql(p.qual, target)})` : '',
      p.check ? `WITH CHECK (${rewriteTenantSql(p.check, target)})` : '',
    ];
    await exec(db, parts.filter(Boolean).join(' '));
  }
  return policies.length;
}

/**
 * Creates schema `target` as an empty structural copy of `wms`. Must run inside a
 * transaction on the PLATFORM (base) handle; throws if the schema already exists.
 */
export async function cloneWmsSchema(db: AppDb, target: string): Promise<CloneReport> {
  assertWmsSchemaName(target);
  if (target === SOURCE) throw new Error('Cannot clone the platform schema onto itself');
  // Fully qualified catalog output for every definition printed below (transaction-local).
  await dbRun(db, sql`SELECT set_config('search_path', 'pg_catalog', true)`);
  // The source ledger exists after `db:migrate`; make sure (test databases migrate directly).
  await ensureTenantLedger(db, SOURCE);
  await exec(db, `CREATE SCHEMA ${ident(target)}`);
  const tables = await cloneTables(db, target);
  await cloneIndexes(db, target);
  const functions = await cloneFunctions(db, target);
  const foreignKeys = await cloneForeignKeys(db, target);
  const triggers = await cloneTriggers(db, target);
  const views = await cloneViews(db, target);
  const policies = await cloneRowSecurity(db, target);
  // Same head as the platform schema: carry the tenant-migration ledger across.
  await exec(
    db,
    `INSERT INTO ${ident(target)}.${ident(TENANT_MIGRATIONS_TABLE)} SELECT * FROM ${ident(SOURCE)}.${ident(TENANT_MIGRATIONS_TABLE)}`,
  );
  await dbRun(db, sql`SELECT set_config('search_path', 'wms, public', true)`);
  return { tables, functions, foreignKeys, triggers, views, policies };
}
