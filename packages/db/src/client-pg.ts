/**
 * node-postgres (pg.Pool) factory, modeled on apps/crm/src/server/db/index.ts.
 * The factory takes a connection string argument — this package never reads env;
 * callers own pooling strategy, global singletons, and lifecycle.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index';

export type KitstakSchema = typeof schema;
export type KitstakPgDatabase = NodePgDatabase<KitstakSchema>;
/** A transaction handle; services accept `KitstakPgExecutor` to run inside or outside a tx. */
export type KitstakPgTransaction = Parameters<Parameters<KitstakPgDatabase['transaction']>[0]>[0];
export type KitstakPgExecutor = KitstakPgDatabase | KitstakPgTransaction;

const DEFAULT_POOL_MAX = 5;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_APPLICATION_NAME = 'kitstak-db';

export interface CreatePgPoolOptions {
  readonly max?: number;
  readonly idleTimeoutMillis?: number;
  readonly connectionTimeoutMillis?: number;
  readonly applicationName?: string;
  /** Idle client errors (e.g. server restart) must not crash the process. */
  readonly onIdleClientError?: (error: Error) => void;
}

export interface PgClientHandle {
  readonly db: KitstakPgDatabase;
  readonly pool: pg.Pool;
  /** Drains the pool. */
  close(): Promise<void>;
}

export function createPgPool(connectionString: string, options: CreatePgPoolOptions = {}): pg.Pool {
  if (!connectionString) {
    throw new Error('@kitstak/db createPgPool: a connection string is required.');
  }
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? DEFAULT_POOL_MAX,
    idleTimeoutMillis: options.idleTimeoutMillis ?? DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    application_name: options.applicationName ?? DEFAULT_APPLICATION_NAME,
  });
  const onIdleClientError =
    options.onIdleClientError ??
    ((error: Error): void => {
      process.stderr.write(`[kitstak-db] idle client error: ${error.message}\n`);
    });
  pool.on('error', onIdleClientError);
  return pool;
}

/** Drizzle database over an existing pool (caller keeps ownership of the pool). */
export function createPgDb(pool: pg.Pool): KitstakPgDatabase {
  return drizzle(pool, { schema });
}

/** Pool + drizzle handle in one call; `close()` drains the pool. */
export function createPgClient(
  connectionString: string,
  options: CreatePgPoolOptions = {},
): PgClientHandle {
  const pool = createPgPool(connectionString, options);
  return { db: createPgDb(pool), pool, close: () => pool.end() };
}

export { schema };
