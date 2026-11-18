/**
 * Database access: one organization's WMS warehouse, read only.
 *
 * Isolation, in layers:
 *  0. CRM, Projects and core tables are shared across orgs: every query filters on the
 *     org id resolved once at startup (WHERE org_id = $1). The WMS adds per-org schemas:
 *  1. The tenant schema is resolved once at startup from core.wms_tenants (status active)
 *     and validated against the same pattern the platform uses before it is ever used as
 *     an identifier.
 *  2. Every tool call runs in its own READ ONLY transaction with SET LOCAL search_path
 *     pinned to that schema (transaction-local, so it is safe on the Supabase transaction
 *     pooler) and a statement timeout. All table references are also schema-qualified.
 *  3. Tools only run fixed, parameterized SQL written here. The model never sends SQL.
 *  4. The connection uses a dedicated read-only Postgres role (sql/readonly-role.sql):
 *     SELECT on one WMS schema and on chosen CRM/Projects/core tables, nothing secret
 *     (no sessions, accounts, API tokens or webhooks). Startup refuses a role that can write.
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

export interface Org {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

/** The organization this server reads (by slug or uuid). Every module filters on its id. */
export async function resolveOrg(sql: Sql, config: Config): Promise<Org> {
  const byId = UUID_RE.test(config.org);
  const rows = await sql.begin('read only', async (tx) => {
    return await tx<{ id: string; name: string; slug: string }[]>`
      SELECT o.id::text AS id, o.name, o.slug FROM core.organization o
      WHERE ${byId ? tx`o.id = ${config.org}::uuid` : tx`o.slug = ${config.org}`}
      LIMIT 1`;
  });
  const row = rows[0];
  if (!row) throw new Error(`No organization found for "${config.org}".`);
  return row;
}

/**
 * The org's active WMS warehouse and the optional client narrowing, or null when the org
 * has no warehouse or the role was not granted its schema.
 */
export async function resolveTenant(sql: Sql, org: Org, config: Config): Promise<Tenant | null> {
  const rows = await sql.begin('read only', async (tx) => {
    return await tx<{ schema_name: string; usable: boolean }[]>`
      SELECT t.schema_name,
        (has_schema_privilege(t.schema_name, 'USAGE') AND COALESCE((
          SELECT has_table_privilege(c.oid, 'SELECT') FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = t.schema_name AND c.relname = 'shipment_orders'), false)) AS usable
      FROM core.wms_tenants t
      WHERE t.org_id = ${org.id}::uuid AND t.status = 'active'
      LIMIT 1`;
  });
  const row = rows[0];
  if (!row || !row.usable) {
    if (config.clientCodes.length > 0) {
      throw new Error("KITSTAK_MCP_CLIENTS is set but this role cannot read the org's WMS warehouse.");
    }
    return null;
  }
  if (!isWmsSchemaName(row.schema_name)) {
    throw new Error(`Refusing unexpected WMS schema name ${JSON.stringify(row.schema_name)}.`);
  }
  const base = { orgId: org.id, orgName: org.name, orgSlug: org.slug, schema: row.schema_name };
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

/** Whether the role can read user names (column grant on core."user") and org members. */
export async function canReadUserNames(sql: Sql): Promise<boolean> {
  const [row] = await sql.begin('read only', async (tx) => {
    return await tx<{ ok: boolean }[]>`
      SELECT (has_schema_privilege('core', 'USAGE')
        AND has_column_privilege('core."user"', 'name', 'SELECT')
        AND has_column_privilege('core."user"', 'id', 'SELECT')
        AND has_table_privilege('core.member', 'SELECT')) AS ok`;
  });
  return row?.ok === true;
}

/**
 * Looks tables up in the catalog by name (not to_regclass, which errors on a schema the
 * role has no USAGE on) so detection works whatever the role was granted.
 */
function splitTable(table: string): [string, string] {
  const [schema, name] = table.split('.');
  if (!schema || !name) throw new Error(`Expected schema.table, got ${table}`);
  return [schema, name];
}

/** A table the role can read, for module detection. */
export async function canRead(sql: Sql, table: string): Promise<boolean> {
  const [schema, name] = splitTable(table);
  const [row] = await sql.begin('read only', async (tx) => {
    return await tx<{ ok: boolean }[]>`
      SELECT COALESCE((
        SELECT has_schema_privilege(n.oid, 'USAGE') AND has_table_privilege(c.oid, 'SELECT')
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ${schema} AND c.relname = ${name}), false) AS ok`;
  });
  return row?.ok === true;
}

/**
 * Refuses to run as a role that can change data, unless explicitly allowed. Checks
 * superuser status and INSERT/UPDATE/DELETE on a sample table of every module in use.
 */
export async function assertReadOnlyRole(
  sql: Sql,
  tables: readonly string[],
  allowWriteRole: boolean,
): Promise<string> {
  const [row] = await sql.begin('read only', async (tx) => {
    return await tx<{ role: string; superuser: boolean; can_write: boolean }[]>`
      SELECT current_user AS role,
        COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS superuser,
        COALESCE((
          SELECT bool_or(has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE')
            OR has_table_privilege(c.oid, 'DELETE'))
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE (n.nspname || '.' || c.relname) IN ${tx(tables as string[])}), false) AS can_write`;
  });
  if (!row) throw new Error('Could not inspect the database role.');
  if ((row.superuser || row.can_write) && !allowWriteRole) {
    throw new Error(
      `Database role "${row.role}" can write to KitStak data. Connect as the read-only role from ` +
        'sql/readonly-role.sql (or set KITSTAK_MCP_ALLOW_WRITE_ROLE=1 for local testing only).',
    );
  }
  return row.role;
}

/** Runs `fn` in a READ ONLY transaction for the shared schemas (core, crm, pm). */
export async function readShared<T>(sql: Sql, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await sql.begin('read only', async (tx) => {
    await tx.unsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    return await fn(tx);
  });
  return result as T;
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
