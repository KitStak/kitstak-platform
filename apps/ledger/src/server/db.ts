/**
 * Database client: Drizzle over node-postgres with the shared `@kitstak/db` schema (core auth,
 * customers, entitlements) merged with this app's `ledger` schema. Single pool per process, reused
 * across dev hot reloads via a global slot (portal/CRM pattern).
 *
 * THE DATABASE GUARD (`LEDGER_DB_GUARD=1`, CONTRACTS section 12, rule 13)
 *
 * The login role owns the `ledger` tables, and an owner skips row level security. With the guard
 * on, `db` never runs a statement as the owner. Every statement and every transaction opens with
 *
 *   SET LOCAL ROLE ledger_app; SELECT set_config('ledger.org_id', '<org uuid>', true)
 *
 * so the policies of `drizzle/0000_ledger_init.sql` apply and a query can only see and write
 * the rows of one workspace, whatever its WHERE clause says. The org comes from the scope in
 * `src/server/db/scope.ts` (`scoped`, `withOrg`, and the escape hatch `asSystem`). The owner
 * handle for better auth is `src/server/db/system.ts`.
 *
 * A statement with no scope at all is refused (`DbGuardError`), so a forgotten scope is an error,
 * never a query as the owner. With the guard off, `db` is the plain pool and nothing changes.
 *
 * WHEN THE PLAIN ROLE CANNOT BE USED. Before the first guarded statement, and again after a
 * refusal, the app tries what it is about to do (`checkGuardRole`: SET LOCAL ROLE ledger_app, the
 * workspace setting, a read of ledger.accounts and core.member, then ROLLBACK). If that fails, the
 * flag is on but the guard is not in force: statements run as the login role, the same as with
 * the flag off, and every failed check writes a loud error line with the reason. It checks again
 * every 30 seconds, so a grant made by hand takes effect without a redeploy. This keeps the app up
 * (the org filter in every domain query is still the first guard) instead of failing every
 * request. `GET /api/health` answers 503 "degraded" while this lasts.
 *
 * TWO LOGINS (optional, CONTRACTS section 12, rule 13). With `LEDGER_OWNER_DATABASE_URL` set,
 * guarded statements use `DATABASE_URL` (a login that owns nothing and may only become ledger_app)
 * and the owner work (`asSystem`, better auth, the guard off) uses the owner URL. Unset, both are
 * the same pool, as before.
 */
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as coreSchema from '@kitstak/db/schema';
import { createPgPool } from '@kitstak/db/client-pg';
import * as ledgerSchema from '@/server/db/schema';
import { DB_GUARD_ROLE, DbGuardError, dbGuardOn, guardSetup, notePermissionDenied } from '@/server/db/scope';
import { env } from '@/server/env';

export const schema = { ...coreSchema, ...ledgerSchema };
export type AppSchema = typeof schema;
export type Database = NodePgDatabase<AppSchema>;
/** A transaction handle. Domain functions accept `Executor` to run inside or outside a tx. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

interface DbGlobal {
  __kitstakLedgerPool?: pg.Pool;
  __kitstakLedgerOwnerPool?: pg.Pool;
  /** Named for the guard with the role check, so a dev server picks up the new pool after a hot reload. */
  __kitstakLedgerGuardedDb?: Database;
  __kitstakLedgerGuardRole?: WeakMap<pg.Pool, GuardRoleState>;
}

const globalSlot = globalThis as typeof globalThis & DbGlobal;

type QueryArgs = [config: string | pg.QueryConfig, values?: unknown[]];

/* ------------------------------------------------------------ can the login use the plain role? */

/** What `checkGuardRole` found. `reason` is a plain sentence when `ready` is false. */
export interface GuardRoleCheck {
  /** The login can become the plain role, the role cannot skip row level security, and it holds its grants. */
  readonly ready: boolean;
  /** True when the answer is certain. False when the database did not answer (nothing is cached then). */
  readonly definite: boolean;
  readonly reason: string | null;
  /** The role the app signs in as. */
  readonly login: string | null;
  /**
   * True when the login itself skips row level security (a superuser, BYPASSRLS, or the owner of
   * the ledger tables), so SQL that runs RESET ROLE would see every workspace. False with a login
   * that owns nothing (the two login setup). Null when it could not be read.
   */
  readonly loginCanStepOut: boolean | null;
}

const ROLE_NAME_RE = /^[a-z_][a-z0-9_]*$/;
const NO_ORG = '00000000-0000-0000-0000-000000000000';

/**
 * Tries exactly what a guarded statement does, on one connection of `pool`, and rolls it back:
 * `BEGIN; SET LOCAL ROLE <role>; set_config('ledger.org_id', ...)`, then a read of `ledger.accounts` and
 * `core.member` and a look at the write grants. Never throws. `role` is for tests with probe roles.
 */
export async function checkGuardRole(pool: pg.Pool, role: string = DB_GUARD_ROLE): Promise<GuardRoleCheck> {
  if (!ROLE_NAME_RE.test(role)) return { ready: false, definite: true, reason: 'The role name is not valid.', login: null, loginCanStepOut: null };
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    return { ready: false, definite: false, reason: `The database did not answer (${error instanceof Error ? error.message : String(error)}).`, login: null, loginCanStepOut: null };
  }
  let login: string | null = null;
  let loginCanStepOut: boolean | null = null;
  const no = (reason: string): GuardRoleCheck => ({ ready: false, definite: true, reason, login, loginCanStepOut });
  let broken: Error | undefined;
  try {
    const me = await client.query<{ login: string; step_out: boolean }>(
      `select current_user::text as login,
              (r.rolsuper or r.rolbypassrls or exists (
                 select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'ledger' and c.relkind in ('r', 'p') and pg_has_role(current_user, c.relowner, 'USAGE'))) as step_out
         from pg_roles r where r.rolname = current_user`,
    );
    login = me.rows[0]?.login ?? null;
    loginCanStepOut = me.rows[0]?.step_out ?? null;
    const found = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>('select rolsuper, rolbypassrls from pg_roles where rolname = $1', [role]);
    const target = found.rows[0];
    if (!target) return no(`The role ${role} is not in the database. Run the Ledger migrations, or make it by hand (CONTRACTS section 12, rule 13).`);
    if (target.rolsuper || target.rolbypassrls) return no(`The role ${role} can skip row level security, so it would not keep workspaces apart. Run: ALTER ROLE ${role} NOSUPERUSER NOBYPASSRLS;`);
    await client.query('BEGIN');
    try {
      try {
        await client.query(`SET LOCAL ROLE "${role}"`);
      } catch (error) {
        if ((error as { code?: string }).code === '42501') {
          return no(`The login ${login ?? 'of the app'} may not switch to ${role}. Run as a database admin: GRANT ${role} TO ${login ?? '<app login>'} WITH SET TRUE; (on PostgreSQL 15 and older: GRANT ${role} TO ${login ?? '<app login>'};)`);
        }
        throw error;
      }
      await client.query(`SELECT set_config('ledger.org_id', '${NO_ORG}', true)`);
      try {
        await client.query('select 1 from ledger.accounts limit 0');
        await client.query('select 1 from core.member limit 0');
      } catch (error) {
        if ((error as { code?: string }).code === '42501') return no(`The role ${role} has no read grant on the ledger tables or on core.member. Apply drizzle/0000_ledger_init.sql again as the owner of the tables.`);
        throw error;
      }
      const writes = await client.query<{ ok: boolean }>(`select has_table_privilege('ledger.accounts', 'INSERT, UPDATE, DELETE') and has_schema_privilege('ledger', 'USAGE') as ok`);
      if (!writes.rows[0]?.ok) return no(`The role ${role} cannot add, change or remove rows in the ledger tables. Apply drizzle/0000_ledger_init.sql again as the owner of the tables.`);
      return { ready: true, definite: true, reason: null, login, loginCanStepOut };
    } finally {
      await client.query('ROLLBACK').catch((error: unknown) => {
        broken = error instanceof Error ? error : new Error(String(error));
      });
    }
  } catch (error) {
    return { ready: false, definite: false, reason: `The check could not finish (${error instanceof Error ? error.message : String(error)}).`, login, loginCanStepOut };
  } finally {
    client.release(broken);
  }
}

/** How long a failed check is trusted before the next statement checks again. */
const GUARD_RECHECK_MS = 30_000;

interface GuardRoleState {
  check: GuardRoleCheck | null;
  at: number;
  pending: Promise<GuardRoleCheck> | null;
}

/** What the last check found, kept per app pool (the app has one; tests make their own). */
function guardRoleState(pool: pg.Pool): GuardRoleState {
  const states = (globalSlot.__kitstakLedgerGuardRole ??= new WeakMap());
  let state = states.get(pool);
  if (!state) {
    state = { check: null, at: 0, pending: null };
    states.set(pool, state);
  }
  return state;
}

function logGuardNotInForce(check: GuardRoleCheck): void {
  console.error(
    `[ledger] THE DATABASE GUARD IS NOT IN FORCE. LEDGER_DB_GUARD is on, but ${check.reason ?? 'the plain role cannot be used.'} ` +
      'Until this is fixed every query runs as the login role, the same as with the flag off. ' +
      'Ledger checks again every 30 seconds. GET /api/health with the health token shows the reason.',
  );
}

/** Runs the check now (health check, tests) and keeps the answer for the guarded statements. */
export async function refreshGuardRole(pool: pg.Pool = getPool()): Promise<GuardRoleCheck> {
  const state = guardRoleState(pool);
  const found = await checkGuardRole(pool);
  if (found.definite) {
    state.check = found;
    state.at = Date.now();
  }
  if (!found.ready && dbGuardOn()) logGuardNotInForce(found);
  return found;
}

/**
 * True when guarded statements may use the plain role. A ready answer is kept until a statement
 * is refused the role; a failed one for 30 seconds. An unsure answer (the database did not
 * answer) is not kept, and the statement goes ahead guarded, where it fails the same way.
 */
async function guardRoleUsable(pool: pg.Pool): Promise<boolean> {
  const state = guardRoleState(pool);
  if (state.check?.ready) return true;
  if (state.check && Date.now() - state.at < GUARD_RECHECK_MS) return false;
  state.pending ??= checkGuardRole(pool)
    .then((found) => {
      if (found.definite) {
        state.check = found;
        state.at = Date.now();
      }
      if (!found.ready && found.definite) logGuardNotInForce(found);
      return found;
    })
    .finally(() => {
      state.pending = null;
    });
  const found = await state.pending;
  return found.ready || !found.definite;
}

/** A guarded statement was refused the plain role itself: check again before the next one. */
function noteGuardFailure(pool: pg.Pool, error: unknown): void {
  const found = error as { code?: unknown; message?: unknown } | null;
  if (found?.code === '42501' && typeof found.message === 'string' && /set role/i.test(found.message)) guardRoleState(pool).check = null;
}

/** Is the guard in force right now? `requested`: the flag. `active`: the last check passed. */
export function dbGuardInForce(pool: pg.Pool = getPool()): { requested: boolean; active: boolean; check: GuardRoleCheck | null } {
  const requested = dbGuardOn();
  const check = guardRoleState(pool).check;
  return { requested, active: requested && Boolean(check?.ready), check };
}

/* ------------------------------------------------------------------------------ the guarded pool */

/**
 * What Drizzle gets in place of the pool. A single statement runs inside its own short
 * transaction (it was its own transaction before, too). `connect()` is what Drizzle calls to
 * start `db.transaction`: the setup runs right after its `begin`. Statements that may run as the
 * owner (guard off, `asSystem`, the plain role not usable) go to the owner pool.
 */
class GuardedPool extends pg.Pool {
  readonly #inner: pg.Pool;
  readonly #owner: () => pg.Pool;

  constructor(inner: pg.Pool, owner: () => pg.Pool) {
    super({ max: 1 });
    this.#inner = inner;
    this.#owner = owner;
  }

  /** The opening statement for this call chain, or null when it runs as the owner. Throws with no scope. */
  async #setup(): Promise<string | null> {
    const setup = guardSetup();
    if (setup === null) return null;
    return (await guardRoleUsable(this.#inner)) ? setup : null;
  }

  /** One promise based signature stands in for the overloads of pg.Pool.query (Drizzle only uses this form). */
  async guardedQuery(...args: QueryArgs): Promise<pg.QueryResult> {
    const setup = await this.#setup();
    if (setup === null) return this.#owner().query(...(args as [pg.QueryConfig, unknown[]]));
    const client = await this.#inner.connect();
    let broken: Error | undefined;
    try {
      await client.query(`BEGIN; ${setup}`);
      const result = await client.query(...(args as [pg.QueryConfig, unknown[]]));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      notePermissionDenied(error);
      noteGuardFailure(this.#inner, error);
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }

  /** Promise form only (Drizzle never passes a callback). */
  async guardedConnect(): Promise<pg.PoolClient> {
    const setup = await this.#setup();
    if (setup === null) return this.#owner().connect();
    const client = await this.#inner.connect();
    let begun = false;
    let released = false;
    const release = (error?: Error | boolean): void => {
      if (released) return;
      released = true;
      client.release(error);
    };
    const guarded = {
      query: async (...args: QueryArgs): Promise<pg.QueryResult> => {
        if (begun) {
          try {
            return await client.query(...(args as [pg.QueryConfig, unknown[]]));
          } catch (error) {
            notePermissionDenied(error);
            throw error;
          }
        }
        const text = typeof args[0] === 'string' ? args[0] : args[0].text;
        if (!/^\s*begin\b/i.test(text)) {
          release();
          throw new DbGuardError('A guarded connection must start with begin.');
        }
        try {
          const result = await client.query(...(args as [pg.QueryConfig, unknown[]]));
          await client.query(setup);
          begun = true;
          return result;
        } catch (error) {
          noteGuardFailure(this.#inner, error);
          // Drizzle sends `begin` outside its try and finally, so a failure here must clean up itself.
          await client.query('ROLLBACK').catch(() => undefined);
          release();
          throw error;
        }
      },
      release,
    };
    return guarded as unknown as pg.PoolClient;
  }
}
// The two methods Drizzle calls. Set on the prototype so the pg.Pool overload types stay as they are.
Object.defineProperty(GuardedPool.prototype, 'query', { value: GuardedPool.prototype.guardedQuery, writable: true, configurable: true });
Object.defineProperty(GuardedPool.prototype, 'connect', { value: GuardedPool.prototype.guardedConnect, writable: true, configurable: true });
// Drizzle tells a pool from a single client by `instanceof Pool` or by the class name. Keep the name through minifying.
Object.defineProperty(GuardedPool, 'name', { value: 'GuardedPool' });

/** The app's pool on `DATABASE_URL`. Guarded statements always run here. */
export function getPool(): pg.Pool {
  globalSlot.__kitstakLedgerPool ??= createPgPool(env.DATABASE_URL, {
    max: env.DB_POOL_MAX,
    applicationName: 'kitstak-ledger',
  });
  return globalSlot.__kitstakLedgerPool;
}

/**
 * The pool for work that runs as the owner: `asSystem`, better auth, and everything while the
 * guard is off or not in force. The same pool as `getPool()` unless `LEDGER_OWNER_DATABASE_URL`
 * is set (the two login setup, CONTRACTS section 12, rule 13).
 */
export function getOwnerPool(): pg.Pool {
  const url = env.LEDGER_OWNER_DATABASE_URL;
  if (!url) return getPool();
  globalSlot.__kitstakLedgerOwnerPool ??= createPgPool(url, {
    max: env.DB_POOL_MAX,
    applicationName: 'kitstak-ledger-owner',
  });
  return globalSlot.__kitstakLedgerOwnerPool;
}

/** A guarded Drizzle handle over two pools (`getDb` uses the app's; tests pass probe logins). */
export function createGuardedDb(appPool: pg.Pool, ownerPool: () => pg.Pool = () => appPool): Database {
  return drizzle(new GuardedPool(appPool, ownerPool), { schema });
}

export function getDb(): Database {
  globalSlot.__kitstakLedgerGuardedDb ??= createGuardedDb(getPool(), getOwnerPool);
  return globalSlot.__kitstakLedgerGuardedDb;
}

function lazyDatabase(resolve: () => Database): Database {
  return new Proxy({} as Database, {
    get(_target, property, receiver) {
      const instance = resolve();
      const value: unknown = Reflect.get(instance, property, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
    },
  });
}

/** Lazily-initialised shared database handle. With the guard on, every statement needs a scope. */
export const db: Database = lazyDatabase(getDb);
