/**
 * Tenant-scoped database handles: one separate WMS warehouse (Postgres schema) per org.
 *
 * Every WMS table is declared `wmsSchema.table(...)`, so Drizzle renders `"wms"."x"`, and
 * ~2,000 raw SQL statements use unqualified names resolved by `search_path`. A tenant handle
 * therefore does two things for every statement it sends:
 *
 *  1. rewrites schema-qualified references to the tenant schema (`"wms".` and a bare
 *     `wms.` identifier prefix) — `rewriteTenantSql`;
 *  2. pins `search_path = <tenant>, public` with `SET LOCAL` INSIDE the same transaction as
 *     the statement, so unqualified raw SQL resolves to the tenant schema.
 *
 * (2) has to be transaction-local: the Supabase pooler runs in transaction mode, so a
 * session-level `SET` could leak to another org's next statement on the same backend.
 * Top-level statements run as a pipelined BEGIN; SET LOCAL; <statement>; COMMIT on one
 * reserved connection (one network round trip); `transaction()` sets the path first.
 *
 * Tenant connections come from their own pool whose startup search_path is `public`, so a
 * statement that somehow missed (2) fails on a missing table instead of reading the platform
 * org's `wms` data. The platform org's schema IS `wms`: it uses the base handle unchanged.
 *
 * Relative imports only (tsx scripts load this module).
 */
import { sql } from 'drizzle-orm';
import { assertWmsSchemaName, isWmsSchemaName, WMS_PLATFORM_SCHEMA } from '@kitstak/db/wms-tenants';
import type { AppDb } from '../api/db';
import * as schema from './schema';

const QUOTED_WMS = /"wms"\./g;
// A bare `wms.` identifier prefix (raw DDL like `CREATE TABLE IF NOT EXISTS wms.pack_drafts`),
// never inside a quoted string literal (`'wms.x'` is preceded by a quote, not matched).
const BARE_WMS = /(^|[\s(,])wms\.(?=[a-z_"])/g;

/** Rewrites `"wms".` / bare `wms.` table references to `schemaName`. Identity for `wms`. */
export function rewriteTenantSql(query: string, schemaName: string): string {
  if (schemaName === WMS_PLATFORM_SCHEMA) return query;
  const quoted = `"${schemaName}".`;
  return query.replace(QUOTED_WMS, quoted).replace(BARE_WMS, (_m, lead: string) => `${lead}${schemaName}.`);
}

/** `search_path` value for a tenant: its schema first, then `public` (shared helpers). */
export function tenantSearchPath(schemaName: string): string {
  return `${assertWmsSchemaName(schemaName)}, public`;
}

/**
 * `SET LOCAL search_path` for a tenant, with the schema INLINED rather than bound as `$1`.
 * postgres-js runs every parameterised statement as two network round trips when
 * `prepare: false` (describe, then bind) and cannot pipeline behind one, so a bound
 * `set_config(..., $1, true)` cost each tenant statement an extra round trip. Inlining is
 * safe: `tenantSearchPath` only accepts names matching `^wms(_[0-9a-f]{32})?$`.
 */
export function setPathSql(schemaName: string): string {
  return `SET LOCAL search_path TO ${tenantSearchPath(schemaName)}`;
}

/**
 * The WMS schema a handle (database OR open transaction) reads/writes, asked of Postgres:
 * a tenant handle pins `search_path` to its schema for every statement, so
 * `current_schema()` is that schema; anything else (platform handle, migration connection
 * on `public`) is the platform schema `wms`.
 */
export async function currentWmsSchema(db: AppDb): Promise<string> {
  const result = (await db.execute(sql`SELECT current_schema() AS s`)) as unknown;
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  const name = (rows[0] as { s?: unknown } | undefined)?.s;
  return typeof name === 'string' && name !== WMS_PLATFORM_SCHEMA && isWmsSchemaName(name)
    ? name
    : WMS_PLATFORM_SCHEMA;
}

// ── postgres-js ──────────────────────────────────────────────────────────────────────

/** The subset of a postgres-js `Sql` / transaction Drizzle's driver touches. */
interface PgJsLike {
  unsafe(query: string, params?: unknown[], options?: unknown): PgJsQuery;
  options: unknown;
}
interface PgJsQuery extends PromiseLike<unknown> {
  values(): PgJsQuery;
  execute(): PgJsQuery;
}
interface PgJsTx extends PgJsLike {
  savepoint<T>(fn: (sp: PgJsTx) => Promise<T>): Promise<T>;
}
interface PgJsReserved extends PgJsLike {
  release(): void;
}
interface PgJsSql extends PgJsLike {
  begin<T>(fn: (tx: PgJsTx) => Promise<T>): Promise<T>;
  reserve(): Promise<PgJsReserved>;
}

/** A transaction (or savepoint) whose statements are rewritten to the tenant schema. */
function rewritingTx(tx: PgJsTx, schemaName: string): PgJsTx {
  return {
    options: tx.options,
    unsafe: (query, params, options) => tx.unsafe(rewriteTenantSql(query, schemaName), params, options),
    savepoint: (fn) => tx.savepoint((sp) => fn(rewritingTx(sp, schemaName))),
  };
}

/**
 * A lazy query object Drizzle can `await` directly or call `.values()` on, like a
 * postgres-js PendingQuery, that runs as one pipelined tenant transaction.
 */
function pipelinedQuery(
  base: PgJsSql,
  schemaName: string,
  query: string,
  params: unknown[] | undefined,
  options: unknown,
): PgJsQuery {
  let arrayMode = false;
  let running: Promise<unknown> | null = null;
  const run = (): Promise<unknown> =>
    (running ??= (async () => {
      const conn = await base.reserve();
      try {
        // Started in order on one connection → pipelined in order, one round trip.
        const begin = conn.unsafe('BEGIN').execute();
        const path = conn.unsafe(setPathSql(schemaName)).execute();
        const main = conn.unsafe(rewriteTenantSql(query, schemaName), params, options);
        const result = (arrayMode ? main.values() : main).execute();
        // COMMIT after a failed statement is answered with ROLLBACK (no error).
        const commit = conn.unsafe('COMMIT').execute();
        const [b, p, r, c] = await Promise.allSettled([begin, path, result, commit]);
        for (const step of [b, p, r, c]) if (step.status === 'rejected') throw step.reason;
        return (r as PromiseFulfilledResult<unknown>).value;
      } finally {
        conn.release();
      }
    })());
  const pending: PgJsQuery = {
    values: () => {
      arrayMode = true;
      return pending;
    },
    execute: () => {
      void run().catch(() => {});
      return pending;
    },
    then: (onFulfilled, onRejected) => run().then(onFulfilled, onRejected),
  };
  return pending;
}

/** A postgres-js client stand-in scoping every statement to `schemaName`. */
export function tenantPostgresClient(base: PgJsSql, schemaName: string): PgJsLike & Pick<PgJsSql, 'begin'> {
  assertWmsSchemaName(schemaName);
  return {
    options: base.options,
    unsafe: (query, params, options) => pipelinedQuery(base, schemaName, query, params, options),
    begin: (fn) =>
      base.begin(async (tx) => {
        // Not awaited on its own: it travels with the transaction's first statement, which
        // the connection runs after it (queries on one connection execute in the order sent).
        const path = tx.unsafe(setPathSql(schemaName)).execute();
        const [, result] = await Promise.allSettled([path, fn(rewritingTx(tx, schemaName))]);
        await path;
        if (result.status === 'rejected') throw result.reason;
        return result.value;
      }),
  };
}

// ── PGlite ───────────────────────────────────────────────────────────────────────────

/** The subset of a PGlite instance / transaction Drizzle's driver touches. */
interface PgliteQueryable {
  query(query: string, params?: unknown[], options?: unknown): Promise<unknown>;
  exec?(query: string): Promise<unknown>;
}
interface PgliteLike extends PgliteQueryable {
  transaction<T>(fn: (tx: PgliteQueryable) => Promise<T>): Promise<T>;
}

function rewritingPgliteTx(tx: PgliteQueryable, schemaName: string): PgliteQueryable {
  return {
    query: (query, params, options) => tx.query(rewriteTenantSql(query, schemaName), params, options),
    exec: (query) => (tx.exec ? tx.exec(rewriteTenantSql(query, schemaName)) : tx.query(rewriteTenantSql(query, schemaName))),
  };
}

/**
 * A PGlite stand-in scoping every statement to `schemaName` (tests / local dev). PGlite is
 * one connection: each top-level statement runs in its own short transaction, which also
 * serializes it against other tenants' work.
 */
export function tenantPgliteClient(base: PgliteLike, schemaName: string): PgliteLike {
  assertWmsSchemaName(schemaName);
  const inTenantTx = <T>(fn: (tx: PgliteQueryable) => Promise<T>): Promise<T> =>
    base.transaction(async (tx) => {
      await tx.query(setPathSql(schemaName));
      return await fn(rewritingPgliteTx(tx, schemaName));
    });
  return {
    query: (query, params, options) => inTenantTx((tx) => tx.query(query, params, options)),
    exec: (query) => inTenantTx((tx) => (tx.exec ? tx.exec(query) : tx.query(query))),
    transaction: (fn) => inTenantTx(fn),
  };
}

// ── Drizzle handles ──────────────────────────────────────────────────────────────────

export type RawClient =
  | { readonly kind: 'postgres'; readonly client: unknown }
  | { readonly kind: 'pglite'; readonly client: unknown };

const TENANT_SCHEMAS = new WeakMap<object, string>();

/**
 * The schema a ROOT tenant handle (from `buildTenantDb`) is scoped to, or undefined for the
 * platform handle and for transactions. Synchronous: the writer gate keys its queues by it.
 */
export function tenantSchemaOf(db: AppDb): string | undefined {
  return TENANT_SCHEMAS.get(db);
}

/** Builds a Drizzle handle over `raw` scoped to `schemaName` (never the platform schema). */
export async function buildTenantDb(raw: RawClient, schemaName: string): Promise<AppDb> {
  assertWmsSchemaName(schemaName);
  if (schemaName === WMS_PLATFORM_SCHEMA) throw new Error('The platform schema uses the base handle');
  let db: AppDb;
  if (raw.kind === 'postgres') {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const client = tenantPostgresClient(raw.client as PgJsSql, schemaName);
    db = drizzle(client as never, { schema }) as unknown as AppDb;
  } else {
    const { drizzle } = await import('drizzle-orm/pglite');
    const client = tenantPgliteClient(raw.client as PgliteLike, schemaName);
    db = drizzle({ client: client as never, schema }) as unknown as AppDb;
  }
  TENANT_SCHEMAS.set(db, schemaName);
  return db;
}
