/**
 * Database client: Drizzle over node-postgres with the shared `@kitstak/db` schema (core auth,
 * customers, entitlements) merged with this app's `pulse` schema. Single pool per process, reused
 * across dev hot reloads via a global slot (portal/CRM pattern).
 */
import type pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as coreSchema from '@kitstak/db/schema';
import { createPgPool } from '@kitstak/db/client-pg';
import * as pulseSchema from '@/server/db/schema';
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

export function getPool(): pg.Pool {
  globalSlot.__kitstakPulsePool ??= createPgPool(env.DATABASE_URL, {
    max: env.DB_POOL_MAX,
    applicationName: 'kitstak-pulse',
  });
  return globalSlot.__kitstakPulsePool;
}

export function getDb(): Database {
  globalSlot.__kitstakPulseDb ??= drizzle(getPool(), { schema });
  return globalSlot.__kitstakPulseDb;
}

/** Lazily-initialised shared database handle. */
export const db: Database = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const instance = getDb();
    const value: unknown = Reflect.get(instance, property, receiver);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
});
