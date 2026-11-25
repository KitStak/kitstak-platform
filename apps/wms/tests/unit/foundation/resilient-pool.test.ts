import { describe, expect, it } from 'vitest';
import {
  DbStallError,
  isQuickStatement,
  isRetryableRead,
  sqlForLog,
  resilientDefaults,
  resilientPool,
  type PgPendingQuery,
  type PgReservedLike,
  type PgSqlLike,
} from '@/server/db/resilient-pool';

/** A fake postgres-js pool: statements answer `ok` unless the pool is told to hang. */
interface FakePool extends PgSqlLike {
  readonly id: number;
  hang: boolean;
  readonly sent: string[];
  ended: { timeout?: number } | null;
}

function fakeQuery(pool: FakePool, sql: string): PgPendingQuery {
  let promise: Promise<unknown> | null = null;
  const start = (): Promise<unknown> =>
    (promise ??= pool.hang
      ? new Promise(() => {}) // a dead connection: never answers
      : Promise.resolve([{ pool: pool.id, sql }]));
  const q: PgPendingQuery = {
    values: () => q,
    execute: () => {
      pool.sent.push(sql);
      void start();
      return q;
    },
    then: (onFulfilled, onRejected) => start().then(onFulfilled, onRejected),
  };
  return q;
}

function factory(hangFirst = false) {
  const pools: FakePool[] = [];
  const create = (): PgSqlLike => {
    const pool: FakePool = {
      id: pools.length,
      hang: hangFirst && pools.length === 0,
      sent: [],
      ended: null,
      options: { parsers: {}, serializers: {} },
      unsafe: (sql) => fakeQuery(pool, sql),
      begin: async (fn) => (pool.hang ? new Promise(() => {}) : fn({ unsafe: (sql) => fakeQuery(pool, sql) })),
      reserve: async (): Promise<PgReservedLike> =>
        pool.hang
          ? new Promise(() => {})
          : { unsafe: (sql) => fakeQuery(pool, sql), release: () => {} },
      end: async (opts) => {
        pool.ended = opts ?? {};
      },
    };
    pools.push(pool);
    return pool;
  };
  return { pools, create };
}

const FAST = { name: 'test', idleResetMs: 1_000, stallMs: 40, transactionStallMs: 80 };

describe('resilientPool idle reset', () => {
  it('replaces the pool before the first statement after a quiet spell', async () => {
    let clock = 0;
    const { pools, create } = factory();
    const pool = resilientPool(create, { ...FAST, now: () => clock });
    await pool.client.unsafe('select 1');
    clock += 1_500;
    const rows = (await pool.client.unsafe('select 2')) as { pool: number }[];
    expect(pool.generation()).toBe(1);
    expect(rows[0]?.pool).toBe(1);
    expect(pools[0]?.ended).toEqual({ timeout: 0 });
  });

  it('keeps the pool while it is in use', async () => {
    let clock = 0;
    const { create } = factory();
    const pool = resilientPool(create, { ...FAST, now: () => clock });
    await pool.client.unsafe('select 1');
    clock += 500;
    await pool.client.unsafe('select 2');
    clock += 500;
    await pool.client.unsafe('select 3');
    expect(pool.generation()).toBe(0);
  });

  it('never resets the first pool before it was used', async () => {
    let clock = 0;
    const { create } = factory();
    const pool = resilientPool(create, { ...FAST, now: () => clock });
    clock += 10_000;
    await pool.client.unsafe('select 1');
    expect(pool.generation()).toBe(0);
  });

  it('carries the driver parsers over to the replacement pool', async () => {
    let clock = 0;
    const { pools, create } = factory();
    const pool = resilientPool(create, { ...FAST, now: () => clock });
    const parse = (v: string) => Number(v);
    pool.client.options.parsers['20'] = parse;
    await pool.client.unsafe('select 1');
    clock += 2_000;
    await pool.client.unsafe('select 2');
    expect(pools[1]?.options.parsers['20']).toBe(parse);
  });
});

describe('resilientPool stall guard', () => {
  it('fails a stuck write fast and replaces the pool instead of hanging', async () => {
    const { pools, create } = factory(true);
    const pool = resilientPool(create, FAST);
    await expect(pool.client.unsafe('update t set a = 1')).rejects.toBeInstanceOf(DbStallError);
    expect(pool.generation()).toBe(1);
    expect(pools[0]?.ended).toEqual({ timeout: 0 });
    // The fresh pool answers.
    await expect(pool.client.unsafe('update t set a = 2')).resolves.toBeTruthy();
  });

  it('retries a plain read once on the fresh pool', async () => {
    const { create } = factory(true);
    const pool = resilientPool(create, FAST);
    const rows = (await pool.client.unsafe('select 1').values()) as { pool: number }[];
    expect(rows[0]?.pool).toBe(1);
  });

  it('gets a connection from the fresh pool when acquisition stalls', async () => {
    const { create } = factory(true);
    const pool = resilientPool(create, FAST);
    const conn = await pool.client.reserve();
    const rows = (await conn.unsafe('select 1')) as { pool: number }[];
    expect(rows[0]?.pool).toBe(1);
    conn.release();
  });

  it('gives a stuck transaction its own longer budget', async () => {
    const { create } = factory(true);
    const pool = resilientPool(create, FAST);
    const started = Date.now();
    await expect(pool.client.begin(async () => 'never')).rejects.toBeInstanceOf(DbStallError);
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
    await expect(pool.client.begin(async (tx) => tx.unsafe('select 1'))).resolves.toBeTruthy();
  });

  it('replaces the pool once when several statements stall on it together', async () => {
    const { create } = factory(true);
    const pool = resilientPool(create, FAST);
    const results = await Promise.allSettled([
      pool.client.unsafe('update a set x = 1'),
      pool.client.unsafe('update b set x = 1'),
      pool.client.unsafe('update c set x = 1'),
    ]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(pool.generation()).toBe(1);
  });
});

describe('isRetryableRead', () => {
  it('accepts plain selects only', () => {
    expect(isRetryableRead('select "id" from "wms"."warehouses" where "id" = $1')).toBe(true);
    expect(isRetryableRead('  SELECT count(*) FROM orders')).toBe(true);
  });

  it('refuses writes, locks and side effects', () => {
    expect(isRetryableRead('insert into t values ($1)')).toBe(false);
    expect(isRetryableRead('update t set a = 1')).toBe(false);
    expect(isRetryableRead('select * from t for update')).toBe(false);
    expect(isRetryableRead("select nextval('s')")).toBe(false);
    expect(isRetryableRead('select pg_advisory_xact_lock(1)')).toBe(false);
    expect(isRetryableRead('select 1; delete from t')).toBe(false);
    expect(isRetryableRead('with x as (delete from t returning *) select * from x')).toBe(false);
  });
});

describe('resilientDefaults', () => {
  it('stays past the server statement timeout and reads env overrides', () => {
    expect(resilientDefaults({})).toEqual({
      idleResetMs: 15_000,
      stallMs: 35_000,
      readStallMs: 8_000,
      transactionStallMs: 120_000,
      slowMs: 3_000,
    });
    expect(resilientDefaults({ DATABASE_READ_STALL_MS: '2500' }).readStallMs).toBe(2_500);
    expect(resilientDefaults({ DATABASE_STALL_MS: '5000', DATABASE_IDLE_RESET_MS: 'nope' }).stallMs).toBe(5_000);
    expect(resilientDefaults({ DATABASE_IDLE_RESET_MS: 'nope' }).idleResetMs).toBe(15_000);
  });
});

describe('resilientPool read budget', () => {
  it('gives up on a silent read far sooner than on a write', async () => {
    const { create } = factory(true);
    const pool = resilientPool(create, { ...FAST, stallMs: 400, readStallMs: 30 });
    const started = Date.now();
    const rows = (await pool.client.unsafe('select 1')) as { pool: number }[];
    expect(rows[0]?.pool).toBe(1);
    expect(Date.now() - started).toBeLessThan(300);
  });

  it('keeps the long budget for writes', async () => {
    const { create } = factory(true);
    const pool = resilientPool(create, { ...FAST, stallMs: 150, readStallMs: 20 });
    const started = Date.now();
    await expect(pool.client.unsafe('update t set a = 1')).rejects.toBeInstanceOf(DbStallError);
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });

  it('retries a read that the pool reset destroyed under it', async () => {
    const { pools, create } = factory(true);
    const pool = resilientPool(create, { ...FAST, stallMs: 30 });
    // The first pool fails every in-flight statement when it is ended, like postgres-js does.
    const first = pools[0] as FakePool;
    const rejectors: ((e: Error) => void)[] = [];
    first.unsafe = (sql) => {
      const p = new Promise((_, reject) => rejectors.push(reject));
      const q: PgPendingQuery = { values: () => q, execute: () => q, then: (a, b) => p.then(a, b) };
      void sql;
      return q;
    };
    first.end = async () => {
      for (const reject of rejectors) reject(new Error('write CONNECTION_DESTROYED'));
    };
    const [write, read] = await Promise.allSettled([
      pool.client.unsafe('update t set a = 1'),
      // Started a moment later: the write's stall tears the pool down under this read.
      new Promise((r) => setTimeout(r, 5)).then(() => pool.client.unsafe('select 2')),
    ]);
    expect(write.status).toBe('rejected');
    expect(read.status).toBe('fulfilled');
  });
});

describe('isQuickStatement and sqlForLog', () => {
  it('treats reads and transaction control as quick, writes as not', () => {
    expect(isQuickStatement('select 1')).toBe(true);
    expect(isQuickStatement('BEGIN')).toBe(true);
    expect(isQuickStatement('COMMIT')).toBe(true);
    expect(isQuickStatement('SET LOCAL search_path TO wms_abc, public')).toBe(true);
    expect(isQuickStatement('update t set a = 1')).toBe(false);
    expect(isQuickStatement('begin; update t set a = 1')).toBe(false);
    expect(isQuickStatement('beginning_balance_report()')).toBe(false);
  });

  it('logs SQL flattened and short, never parameters', () => {
    expect(sqlForLog('select  *\n  from t\n where id = $1')).toBe('select * from t where id = $1');
    expect(sqlForLog(`select ${'x'.repeat(300)}`).length).toBe(161);
  });
});
