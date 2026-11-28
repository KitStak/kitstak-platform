/**
 * The owner handle, with no guard: the second escape hatch of the database guard (CONTRACTS section 12, rule 13),
 * for better auth only. Better auth keeps its own tables in `core` and runs before any workspace
 * is known. Nothing else may import this file (`src/server/db-guard.test.ts`).
 *
 * Also the health check of the guard: is the flag on, can this login become the plain role, and
 * is the guard in force right now?
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { dbGuardInForce, getOwnerPool, refreshGuardRole, schema, type Database } from '@/server/db';
import { DB_GUARD_ROLE, dbGuardOn } from '@/server/db/scope';

interface SystemGlobal {
  __kitstakLedgerSystemDb?: Database;
}
const globalSlot = globalThis as typeof globalThis & SystemGlobal;

const resolve = (): Database => (globalSlot.__kitstakLedgerSystemDb ??= drizzle(getOwnerPool(), { schema }));

export const systemDb: Database = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const instance = resolve();
    const value: unknown = Reflect.get(instance, property, receiver);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
});

export interface DbGuardStatus {
  /** LEDGER_DB_GUARD is set. */
  readonly on: boolean;
  /** The flag is on and the plain role works: statements run as `ledger_app` right now. */
  readonly active: boolean;
  /**
   * The app's login can do what a guarded statement does (it really switches to ledger_app in a
   * transaction that is rolled back), the role cannot skip row level security, and it holds its
   * grants. Checked fresh on every call.
   */
  readonly ready: boolean;
  /** Why `ready` is false, in plain words with the SQL to run. Null when ready. */
  readonly reason: string | null;
  readonly role: string;
  /** The login the app signs in as. */
  readonly login: string | null;
  /** The login itself skips row level security, so SQL that steps back out of the plain role sees every workspace. */
  readonly loginCanStepOut: boolean | null;
}

/** The state of the guard, checked fresh. Never throws. */
export async function dbGuardStatus(): Promise<DbGuardStatus> {
  const check = await refreshGuardRole();
  const on = dbGuardOn();
  return { on, active: on && dbGuardInForce().active, ready: check.ready, reason: check.reason, role: DB_GUARD_ROLE, login: check.login, loginCanStepOut: check.loginCanStepOut };
}
