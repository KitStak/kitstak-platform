/**
 * A postgres-js pool that cannot wedge (production incident 2026-11-25: a new organization's
 * warehouse never loaded; every page hung until Vercel killed it at 300 s).
 *
 * postgres-js has no acquire timeout and no client-side query timeout. On Vercel a function
 * instance sits idle (or frozen) between requests; a pooled connection whose network path died
 * meanwhile never answers, and its own idle close waits for a reply that never comes. That slot
 * is then never handed out again, and with a pool of 3 every later query on the instance waits
 * forever while the database sees nothing at all. Low-traffic instances (one person clicking
 * around a new warehouse) hit it on almost every request.
 *
 * Two defenses, both swapping the underlying pool for a fresh one:
 *  1. idle reset: before the first statement after the pool sat unused for `idleResetMs`, the
 *     old pool is destroyed and a new one opened. Only when nothing is in flight, so it never
 *     breaks a running request. Costs one reconnect after a quiet spell.
 *  2. stall guard: a statement (or connection acquisition, or transaction) that does not settle
 *     within its budget destroys the pool, which rejects everything stuck on it, and fails with
 *     `DbStallError` instead of hanging. A plain read is retried once on the fresh pool.
 *
 * The wrapper exposes what Drizzle (`unsafe`, `begin`, `options`) and the tenant layer
 * (`reserve`, ./tenant.ts) use, and delegates to whichever pool is current.
 *
 * Relative imports only (tsx scripts load this module).
 */
import { log } from '../log';

/** The postgres-js surface this module drives (structural, so tests can pass fakes). */
export interface PgPendingQuery extends PromiseLike<unknown> {
  values(): PgPendingQuery;
  execute(): PgPendingQuery;
}
export interface PgTxLike {
  unsafe(query: string, params?: unknown[], options?: unknown): PgPendingQuery;
}
export interface PgReservedLike extends PgTxLike {
  release(): void;
}
export interface PgSqlLike extends PgTxLike {
  readonly options: { parsers: Record<string, unknown>; serializers: Record<string, unknown> } & Record<string, unknown>;
  begin<T>(fn: (tx: PgTxLike) => Promise<T>): Promise<T>;
  reserve(): Promise<PgReservedLike>;
  end(options?: { timeout?: number }): Promise<void>;
}

export interface ResilientPoolOptions {
  /** Pool label for logs ("platform" / "tenant"). */
  readonly name: string;
  /** Reset the pool before reuse after this long without any statement. */
  readonly idleResetMs: number;
  /** Budget for one statement or one connection acquisition. */
  readonly stallMs: number;
  /**
   * Budget for a statement that is instant on a live connection: a plain read, or the tenant
   * layer's BEGIN / SET LOCAL / COMMIT. Silence this long means a dead connection, not a slow query.
   */
  readonly readStallMs?: number;
  /** A statement slower than this (that still answered) is logged, with its SQL, as slow. */
  readonly slowMs?: number;
  /** Budget for a whole transaction (many statements). */
  readonly transactionStallMs: number;
  readonly now?: () => number;
}

/** A statement, acquisition or transaction did not settle in time; the pool was replaced. */
export class DbStallError extends Error {
  readonly code = 'DB_STALL';
  constructor(
    readonly pool: string,
    readonly what: string,
    readonly ms: number,
  ) {
    super(`Database ${what} on the ${pool} pool did not answer within ${ms} ms; the connections were reset`);
    this.name = 'DbStallError';
  }
}

// A plain read that is safe to send twice: one SELECT, no locking, no sequence or side effect.
const READ_ONLY = /^\s*select\b/i;
const SIDE_EFFECTS = /\b(for\s+(no\s+key\s+)?update|for\s+share|nextval|setval|pg_advisory\w*|pg_try_advisory\w*|set_config|pg_notify|into)\b/i;

/** True for a statement that is safe to retry after a stall (it changes nothing). */
export function isRetryableRead(query: string): boolean {
  return READ_ONLY.test(query) && !SIDE_EFFECTS.test(query) && !query.includes(';');
}

const CONTROL = /^\s*(begin|commit|rollback|set\s+local)\b/i;

/** True for a statement that answers at once on a live connection (gets the short read budget). */
export function isQuickStatement(query: string): boolean {
  return isRetryableRead(query) || (CONTROL.test(query) && !query.includes(';'));
}

/** The SQL for a log line: whitespace collapsed, cut short. Parameters are never logged. */
export function sqlForLog(query: string): string {
  const flat = query.replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
}

/**
 * Env knobs (milliseconds): DATABASE_IDLE_RESET_MS, DATABASE_STALL_MS, DATABASE_READ_STALL_MS,
 * DATABASE_TX_STALL_MS, DATABASE_SLOW_MS.
 */
export function resilientDefaults(env: Readonly<Record<string, string | undefined>> = process.env): {
  idleResetMs: number;
  stallMs: number;
  readStallMs: number;
  transactionStallMs: number;
  slowMs: number;
} {
  const num = (value: string | undefined, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    // Shorter than postgres-js idle_timeout (20 s): a pool that quiet would be reconnecting anyway.
    idleResetMs: num(env.DATABASE_IDLE_RESET_MS, 15_000),
    // Past the server-side statement_timeout (30 s), so no statement the server would still run is cut.
    stallMs: num(env.DATABASE_STALL_MS, 35_000),
    // Production 2026-11-25: a read on a fresh connection went silent for 35 s, then answered at
    // once when retried. A plain read that quiet is a dead connection; fail over far sooner.
    readStallMs: num(env.DATABASE_READ_STALL_MS, 8_000),
    transactionStallMs: num(env.DATABASE_TX_STALL_MS, 120_000),
    slowMs: num(env.DATABASE_SLOW_MS, 3_000),
  };
}

export interface ResilientPool {
  /** The postgres-js stand-in to hand to Drizzle and the tenant layer. */
  readonly client: PgSqlLike;
  /** How many times the underlying pool was replaced (tests, diagnostics). */
  readonly generation: () => number;
  end(options?: { timeout?: number }): Promise<void>;
}

/** Wraps a pool factory; `create` must return a NEW postgres-js pool on every call. */
export function resilientPool(create: () => PgSqlLike, options: ResilientPoolOptions): ResilientPool {
  const now = options.now ?? Date.now;
  let current = create();
  let generation = 0;
  let inFlight = 0;
  let lastActivity = now();
  let used = false;

  const replace = (reason: string, details: Record<string, unknown> = {}): void => {
    const old = current;
    current = create();
    // Drizzle (and openPostgres) install parsers/serializers on the pool's options; carry them over.
    Object.assign(current.options.parsers, old.options.parsers);
    Object.assign(current.options.serializers, old.options.serializers);
    generation += 1;
    lastActivity = now();
    // An idle reset is routine on a quiet instance; a stall is the incident this module exists for.
    (reason === 'stall' ? log.warn : log.info)('database pool reset', { pool: options.name, reason, generation, ...details });
    // timeout 0 destroys the sockets at once: anything stuck on them rejects instead of hanging.
    void old.end({ timeout: 0 }).catch(() => {});
  };

  const beforeUse = (): void => {
    if (used && inFlight === 0 && now() - lastActivity > options.idleResetMs) {
      replace('idle', { idleMs: now() - lastActivity });
    }
    used = true;
  };

  /** Runs `start` with in-flight tracking; a stall replaces the pool and rejects. */
  const guarded = async <T>(
    what: string,
    budgetMs: number,
    start: () => PromiseLike<T>,
    sql?: string,
  ): Promise<T> => {
    const startedOn = generation;
    const startedAt = Date.now();
    inFlight += 1;
    lastActivity = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stalled = false;
    try {
      const stall = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          stalled = true;
          // Only the first stall on a pool replaces it; later ones on the same dead pool just fail.
          if (generation === startedOn) replace('stall', { what, ms: budgetMs, ...(sql ? { sql } : {}) });
          reject(new DbStallError(options.name, what, budgetMs));
        }, budgetMs);
      });
      return await Promise.race([Promise.resolve(start()), stall]);
    } finally {
      clearTimeout(timer);
      inFlight -= 1;
      lastActivity = now();
      const tookMs = Date.now() - startedAt;
      if (!stalled && tookMs >= (options.slowMs ?? Number.POSITIVE_INFINITY)) {
        log.warn('slow database statement', { pool: options.name, what, ms: tookMs, ...(sql ? { sql } : {}) });
      }
    }
  };

  /** A lazy, awaitable stand-in for a postgres-js PendingQuery (`values()` / `execute()` / await). */
  const lazyQuery = (run: (arrayMode: boolean) => Promise<unknown>): PgPendingQuery => {
    let arrayMode = false;
    let running: Promise<unknown> | null = null;
    const go = (): Promise<unknown> => (running ??= run(arrayMode));
    const pending: PgPendingQuery = {
      values: () => {
        arrayMode = true;
        return pending;
      },
      execute: () => {
        void go().catch(() => {});
        return pending;
      },
      then: (onFulfilled, onRejected) => go().then(onFulfilled, onRejected),
    };
    return pending;
  };

  const statement = (
    target: () => PgTxLike,
    query: string,
    params: unknown[] | undefined,
    queryOptions: unknown,
    retry: boolean,
  ): PgPendingQuery =>
    lazyQuery(async (arrayMode) => {
      const budget = isQuickStatement(query) ? (options.readStallMs ?? options.stallMs) : options.stallMs;
      const sql = sqlForLog(query);
      let startedOn = generation;
      const once = (): Promise<unknown> => {
        startedOn = generation;
        return guarded(
          'statement',
          budget,
          () => {
            const q = target().unsafe(query, params, queryOptions);
            return (arrayMode ? q.values() : q).execute();
          },
          sql,
        );
      };
      try {
        return await once();
      } catch (error) {
        // A stall, or the pool torn down under it by another statement's stall (CONNECTION_DESTROYED).
        const poolFailed = error instanceof DbStallError || generation !== startedOn;
        if (!(retry && poolFailed && isRetryableRead(query))) throw error;
        log.warn('retrying a read after a database stall', { pool: options.name, sql });
        return await once();
      }
    });

  const client: PgSqlLike = {
    get options() {
      return current.options;
    },
    unsafe: (query, params, queryOptions) => {
      beforeUse();
      return statement(() => current, query, params, queryOptions, true);
    },
    begin: (fn) => {
      beforeUse();
      // Statements inside run on the transaction's own connection; the whole transaction has a budget.
      return guarded('transaction', options.transactionStallMs, () => current.begin(fn));
    },
    reserve: async () => {
      beforeUse();
      const acquire = (): Promise<PgReservedLike> => guarded('connection acquisition', options.stallMs, () => current.reserve());
      let conn: PgReservedLike;
      try {
        conn = await acquire();
      } catch (error) {
        if (!(error instanceof DbStallError)) throw error;
        conn = await acquire(); // the pool was just replaced; one more try on the fresh one
      }
      return {
        unsafe: (query, params, queryOptions) => statement(() => conn, query, params, queryOptions, false),
        release: () => conn.release(),
      };
    },
    end: (endOptions) => current.end(endOptions),
  };

  return { client, generation: () => generation, end: (endOptions) => current.end(endOptions) };
}
