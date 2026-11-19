/**
 * Database client: Drizzle over node-postgres with the shared `@kitstak/db` schema (core auth,
 * customers, entitlements) merged with this app's `pulse` schema. Single pool per process, reused
 * across dev hot reloads via a global slot (portal/CRM pattern).
 *
 * THE DATABASE GUARD (`PULSE_DB_GUARD=1`, CONTRACTS section 12, rule 13)
 *
 * The login role owns the `pulse` tables, and an owner skips row level security. With the guard
 * on, `db` never runs a statement as the owner. Every statement and every transaction opens with
 *
 *   SET LOCAL ROLE pulse_app; SELECT set_config('pulse.org_id', '<org uuid>', true)
 *
 * so the policies of `drizzle/0007_rls_policies.sql` apply and a query can only see and write
 * the rows of one workspace, whatever its WHERE clause says. The org comes from the scope in
 * `src/server/db/scope.ts` (`scoped`, `withOrg`, and the escape hatch `asSystem`). The owner
 * handle for better auth is `src/server/db/system.ts`.
 *
 * A statement with no scope at all is refused (`DbGuardError`), so a forgotten scope is an error,
 * never a query as the owner. With the guard off, `db` is the plain pool and nothing changes.
 */
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as coreSchema from '@kitstak/db/schema';
import { createPgPool } from '@kitstak/db/client-pg';
import * as pulseSchema from '@/server/db/schema';
import { DbGuardError, guardSetup, notePermissionDenied } from '@/server/db/scope';
import { env } from '@/server/env';

export const schema = { ...coreSchema, ...pulseSchema };
export type AppSchema = typeof schema;
export type Database = NodePgDatabase<AppSchema>;
/** A transaction handle. Domain functions accept `Executor` to run inside or outside a tx. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

interface DbGlobal {
  __kitstakPulsePool?: pg.Pool;
  __kitstakPulseDb?: Database;
}

const globalSlot = globalThis as typeof globalThis & DbGlobal;

type QueryArgs = [config: string | pg.QueryConfig, values?: unknown[]];

/**
 * What Drizzle gets in place of the pool. A single statement runs inside its own short
 * transaction (it was its own transaction before, too). `connect()` is what Drizzle calls to
 * start `db.transaction`: the setup runs right after its `begin`.
 */
class GuardedPool extends pg.Pool {
  readonly #inner: pg.Pool;

  constructor(inner: pg.Pool) {
    super({ max: 1 });
    this.#inner = inner;
  }

  /** One promise based signature stands in for the overloads of pg.Pool.query (Drizzle only uses this form). */
  async guardedQuery(...args: QueryArgs): Promise<pg.QueryResult> {
    const setup = guardSetup();
    if (setup === null) return this.#inner.query(...(args as [pg.QueryConfig, unknown[]]));
    const client = await this.#inner.connect();
    let broken: Error | undefined;
    try {
      await client.query(`BEGIN; ${setup}`);
      const result = await client.query(...(args as [pg.QueryConfig, unknown[]]));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      notePermissionDenied(error);
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
    const setup = guardSetup();
    const client = await this.#inner.connect();
    if (setup === null) return client;
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

export function getPool(): pg.Pool {
  globalSlot.__kitstakPulsePool ??= createPgPool(env.DATABASE_URL, {
    max: env.DB_POOL_MAX,
    applicationName: 'kitstak-pulse',
  });
  return globalSlot.__kitstakPulsePool;
}

export function getDb(): Database {
  globalSlot.__kitstakPulseDb ??= drizzle(new GuardedPool(getPool()), { schema });
  return globalSlot.__kitstakPulseDb;
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
