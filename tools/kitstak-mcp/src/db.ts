/**
 * Database access: one organization's WMS warehouse, read only.
 *
 * Isolation, in layers:
 *  1. The tenant schema is resolved once at startup from core.wms_tenants (status active)
 *     and validated against the same pattern the platform uses before it is ever used as
 *     an identifier.
 *  2. Every tool call runs in its own READ ONLY transaction with SET LOCAL search_path
 *     pinned to that schema (transaction-local, so it is safe on the Supabase transaction
 *     pooler) and a statement timeout. All table references are also schema-qualified.
 *  3. Tools only run fixed, parameterized SQL written here. The model never sends SQL.
 *  4. The connection uses a dedicated read-only Postgres role granted SELECT on one tenant
 *     schema only (sql/readonly-role.sql). Startup refuses a role that can write.
 */
import postgres from 'postgres';
import type { Config } from './config.js';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

const SCHEMA_NAME_RE = /^wms(_[0-9a-f]{32})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATEMENT_TIMEOUT_MS = 15_000;

export interface Tenant {
  readonly orgId: string;
  readonly orgName: string;
  readonly orgSlug: string;
  readonly schema: string;
  /** Client ids this server may read, or 'all'. */
  readonly clientIds: readonly string[] | 'all';
  readonly clientCodes: readonly string[];
}

export function isWmsSchemaName(name: string): boolean {
  return SCHEMA_NAME_RE.test(name);
}

export function connect(config: Config): Sql {
  return postgres(config.databaseUrl, {
    // Supabase transaction-mode pooler: no server-side prepared statements.
    prepare: false,
    max: 2,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 300,
    onnotice: () => {},
    connection: { application_name: 'kitstak-mcp' },
    // int8 (COUNT/SUM) as a number when safe, like the WMS app does.
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (v: number | bigint) => String(v),
        parse: (v: string) => {
          const n = Number(v);
          return Number.isSafeInteger(n) ? n : v;
        },
      },
    },
  });
}

/** Resolves the org's active warehouse schema and the optional client narrowing. */
export async function resolveTenant(sql: Sql, config: Config): Promise<Tenant> {
  const byId = UUID_RE.test(config.org);
  const rows = await sql.begin('read only', async (tx) => {
    return await tx<{ org_id: string; name: string; slug: string; schema_name: string }[]>`
      SELECT o.id::text AS org_id, o.name, o.slug, t.schema_name
      FROM core.wms_tenants t
      JOIN core.organization o ON o.id = t.org_id
      WHERE t.status = 'active'
        AND ${byId ? tx`o.id = ${config.org}::uuid` : tx`o.slug = ${config.org}`}
      LIMIT 1`;
  });
  const row = rows[0];
  if (!row) throw new Error(`No active WMS warehouse found for organization "${config.org}".`);
  if (!isWmsSchemaName(row.schema_name)) {
    throw new Error(`Refusing unexpected WMS schema name ${JSON.stringify(row.schema_name)}.`);
  }
  const base = { orgId: row.org_id, orgName: row.name, orgSlug: row.slug, schema: row.schema_name };
  if (config.clientCodes.length === 0) return { ...base, clientIds: 'all', clientCodes: [] };

  const clients = await readTenant(
    sql,
    { ...base, clientIds: 'all', clientCodes: [] },
    (tx, s) =>
      tx<
        { id: string; code: string }[]
      >`SELECT id, code FROM ${s}.clients WHERE code IN ${tx(config.clientCodes as string[])}`,
  );
  const found = new Set(clients.map((c) => c.code));
  const unknown = config.clientCodes.filter((c) => !found.has(c));
  if (unknown.length > 0)
    throw new Error(`Unknown client code(s) in KITSTAK_MCP_CLIENTS: ${unknown.join(', ')}`);
  return { ...base, clientIds: clients.map((c) => c.id), clientCodes: config.clientCodes };
}

/**
 * Refuses to run as a role that can change the warehouse, unless explicitly allowed.
 * Checks INSERT/UPDATE/DELETE on the tenant's orders table and superuser status.
 */
export async function assertReadOnlyRole(sql: Sql, tenant: Tenant, allowWriteRole: boolean): Promise<string> {
  const table = `${tenant.schema}.shipment_orders`;
  const [row] = await sql.begin('read only', async (tx) => {
    return await tx<{ role: string; superuser: boolean; can_write: boolean }[]>`
      SELECT current_user AS role,
        COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS superuser,
        (has_table_privilege(${table}::text, 'INSERT')
          OR has_table_privilege(${table}::text, 'UPDATE')
          OR has_table_privilege(${table}::text, 'DELETE')) AS can_write`;
  });
  if (!row) throw new Error('Could not inspect the database role.');
  if ((row.superuser || row.can_write) && !allowWriteRole) {
    throw new Error(
      `Database role "${row.role}" can write to the warehouse. Connect as the read-only role from ` +
        'sql/readonly-role.sql (or set KITSTAK_MCP_ALLOW_WRITE_ROLE=1 for local testing only).',
    );
  }
  return row.role;
}

/**
 * Runs `fn` in a READ ONLY transaction scoped to the tenant schema. `s` is the escaped
 * schema identifier for qualifying table names.
 */
export async function readTenant<T>(
  sql: Sql,
  tenant: Tenant,
  fn: (tx: Tx, s: postgres.Helper<string>) => Promise<T>,
): Promise<T> {
  if (!isWmsSchemaName(tenant.schema)) throw new Error('Invalid tenant schema');
  const result = await sql.begin('read only', async (tx) => {
    // Inlined, not bound: SET does not take parameters. Safe: validated by SCHEMA_NAME_RE.
    await tx.unsafe(`SET LOCAL search_path TO ${tenant.schema}, public`);
    await tx.unsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    return await fn(tx, tx(tenant.schema));
  });
  return result as T;
}

/** `AND <column> IN (...)` when the server is narrowed to some clients, else nothing. */
export function clientScope(tx: Tx, tenant: Tenant, column: string): postgres.PendingQuery<postgres.Row[]> {
  if (tenant.clientIds === 'all') return tx``;
  return tx`AND ${tx(column)} IN ${tx(tenant.clientIds as string[])}`;
}
