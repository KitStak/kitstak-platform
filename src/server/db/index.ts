/**
 * Database client (Drizzle over node-postgres). Single pool per process; reused across
 * Next.js dev hot reloads via a global slot.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '@/server/env';
import * as schema from './schema';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
/** A transaction handle; services accept `Executor` so they can run inside or outside a tx. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

interface DbGlobal {
  __kitstakPool?: pg.Pool;
  __kitstakDb?: Database;
}

const globalSlot = globalThis as typeof globalThis & DbGlobal;

function createPool(): pg.Pool {
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'kitstak-crm',
  });
  pool.on('error', (error) => {
    // Idle client errors (e.g. server restart) must not crash the process.
    process.stderr.write(`[db] idle client error: ${error.message}\n`);
  });
  return pool;
}

export function getPool(): pg.Pool {
  globalSlot.__kitstakPool ??= createPool();
  return globalSlot.__kitstakPool;
}

export function getDb(): Database {
  globalSlot.__kitstakDb ??= drizzle(getPool(), { schema, casing: 'snake_case' });
  return globalSlot.__kitstakDb;
}

/** Lazily-initialised shared database handle. */
export const db: Database = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const instance = getDb();
    const value: unknown = Reflect.get(instance, property, receiver);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
});

/** Round-trip check used by the health endpoint. */
export async function pingDatabase(): Promise<
  { ok: true; latencyMs: number } | { ok: false; error: string }
> {
  const started = performance.now();
  try {
    await getPool().query('select 1');
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown database error' };
  }
}

export { schema };
