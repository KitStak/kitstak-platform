/**
 * postgres-js factory, modeled on apps/wms/src/server/db/index.ts `openPostgres`.
 * `prepare: false` is non-negotiable: the Supabase transaction-mode pooler (:6543)
 * rejects server-side prepared statements. The factory takes a connection string
 * argument — this package never reads env.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export type KitstakSchema = typeof schema;
export type KitstakPostgresJsDatabase = PostgresJsDatabase<KitstakSchema>;

const DEFAULT_POOL_MAX = 5;
const DEFAULT_IDLE_TIMEOUT_S = 20;
const DEFAULT_CONNECT_TIMEOUT_S = 10;
const DEFAULT_MAX_LIFETIME_S = 300;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_APPLICATION_NAME = 'kitstak-db';

export interface CreatePostgresJsOptions {
  readonly max?: number;
  readonly idleTimeoutSeconds?: number;
  readonly connectTimeoutSeconds?: number;
  /** Connection recycling cap in seconds (serverless self-healing); null disables. */
  readonly maxLifetimeSeconds?: number | null;
  /** Server-side statement_timeout in ms (startup parameter); null disables (migrations). */
  readonly statementTimeoutMs?: number | null;
  readonly applicationName?: string;
}

export interface PostgresJsClientHandle {
  readonly db: KitstakPostgresJsDatabase;
  readonly client: postgres.Sql;
  /** Ends the pool (5s drain timeout, like WMS). */
  close(): Promise<void>;
}

export function createPostgresJsSql(
  connectionString: string,
  options: CreatePostgresJsOptions = {},
): postgres.Sql {
  if (!connectionString) {
    throw new Error('@kitstak/db createPostgresJsSql: a connection string is required.');
  }
  return postgres(connectionString, {
    // Supabase transaction-mode pooler: no server-side prepared statements.
    prepare: false,
    max: options.max ?? DEFAULT_POOL_MAX,
    // Serverless self-healing: a connection poisoned by a suspended instance (query frozen
    // in flight, postgres-js has NO acquire timeout so later queries queue silently) must
    // recycle within minutes instead of wedging the pool forever.
    idle_timeout: options.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_S,
    connect_timeout: options.connectTimeoutSeconds ?? DEFAULT_CONNECT_TIMEOUT_S,
    max_lifetime: options.maxLifetimeSeconds === null ? null : (options.maxLifetimeSeconds ?? DEFAULT_MAX_LIFETIME_S),
    onnotice: () => {},
    connection: {
      application_name: options.applicationName ?? DEFAULT_APPLICATION_NAME,
      // Server-side kill switch: the backend cancels statements running past the cap even
      // while the client is frozen. Startup parameter (ms); Supavisor transaction mode may
      // ignore it — defense in depth, never correctness.
      ...(options.statementTimeoutMs === null
        ? {}
        : { statement_timeout: options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS }),
    },
  });
}

/** Drizzle database over an existing postgres-js client (caller keeps ownership). */
export function createPostgresJsDb(client: postgres.Sql): KitstakPostgresJsDatabase {
  return drizzle(client, { schema });
}

/** Client + drizzle handle in one call; `close()` ends the pool. */
export function createPostgresJsClient(
  connectionString: string,
  options: CreatePostgresJsOptions = {},
): PostgresJsClientHandle {
  const client = createPostgresJsSql(connectionString, options);
  return {
    db: createPostgresJsDb(client),
    client,
    close: () => client.end({ timeout: 5 }),
  };
}

export { schema };
