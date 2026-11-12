/**
 * Database client (Drizzle over node-postgres via @kitstak/db factories). Single pool per
 * process, reused across Next.js dev hot reloads via a global slot (CRM pattern).
 */
import type pg from 'pg';
import { createPgDb, createPgPool, type KitstakPgDatabase } from '@kitstak/db/client-pg';
import { env } from '@/server/env';

export type Database = KitstakPgDatabase;

interface DbGlobal {
  __kitstakPortalPool?: pg.Pool;
  __kitstakPortalDb?: Database;
}

const globalSlot = globalThis as typeof globalThis & DbGlobal;

export function getPool(): pg.Pool {
  globalSlot.__kitstakPortalPool ??= createPgPool(env.DATABASE_URL, {
    max: env.DB_POOL_MAX,
    applicationName: 'kitstak-portal',
  });
  return globalSlot.__kitstakPortalPool;
}

export function getDb(): Database {
  globalSlot.__kitstakPortalDb ??= createPgDb(getPool());
  return globalSlot.__kitstakPortalDb;
}

/** Lazily-initialised shared database handle. */
export const db: Database = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const instance = getDb();
    const value: unknown = Reflect.get(instance, property, receiver);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
});
