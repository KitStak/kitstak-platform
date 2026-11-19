/**
 * The owner handle, with no guard: the second escape hatch of the database guard (CONTRACTS section 12, rule 13),
 * for better auth only. Better auth keeps its own tables in `core` and runs before any workspace
 * is known. Nothing else may import this file (`src/server/db-guard.test.ts`).
 *
 * Also the health check of the guard: is the flag on, and can this login become the plain role?
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { getPool, schema, type Database } from '@/server/db';
import { DB_GUARD_ROLE, dbGuardOn } from '@/server/db/scope';

interface SystemGlobal {
  __kitstakPulseSystemDb?: Database;
}
const globalSlot = globalThis as typeof globalThis & SystemGlobal;

const resolve = (): Database => (globalSlot.__kitstakPulseSystemDb ??= drizzle(getPool(), { schema }));

export const systemDb: Database = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const instance = resolve();
    const value: unknown = Reflect.get(instance, property, receiver);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
});

/**
 * `on`: PULSE_DB_GUARD is set. `ready`: the plain role exists, is not a superuser, cannot skip
 * row level security, this login can become it, and it holds its grants. Never throws.
 */
export async function dbGuardStatus(): Promise<{ on: boolean; ready: boolean; role: string }> {
  let ready = false;
  try {
    const result = await getPool().query<{ ok: boolean }>(
      `select exists (
         select 1 from pg_roles r
          where r.rolname = $1 and not r.rolsuper and not r.rolbypassrls
            and pg_has_role(current_user, r.oid, 'MEMBER')
            and has_schema_privilege(r.oid, 'pulse', 'USAGE')
            and has_table_privilege(r.oid, 'pulse.jobs', 'SELECT, INSERT, UPDATE, DELETE')
            and has_table_privilege(r.oid, 'core.member', 'SELECT')
       ) as ok`,
      [DB_GUARD_ROLE],
    );
    ready = Boolean(result.rows[0]?.ok);
  } catch {
    ready = false;
  }
  return { on: dbGuardOn(), ready, role: DB_GUARD_ROLE };
}
