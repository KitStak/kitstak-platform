/**
 * Postgres foundation (docs/POSTGRES_MIGRATION.md): RLS coverage, driver selection, raw-SQL
 * helpers, the app write lock and savepoint semantics.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { databaseUrl, openDatabase, parseInt8, poolMax } from '@/server/db';
import { isTransactionPoolerUrl, migrationUrl } from '@/server/db/migrate';
import {
  bestEffort,
  dbAll,
  dbGet,
  dbRun,
  filterSeq,
  inSavepoint,
  isUniqueViolation,
  mapSeq,
  pgErrorCode,
  rowCount,
  rowsOf,
  takeWriteLock,
  withWriteTx,
  PG_UNIQUE_VIOLATION,
  WRITE_LOCK_KEY,
} from '@/server/db/sql';
import { defaultBlobStorage, supabaseStorageConfigured } from '@/server/files';
import { shouldStartScheduler } from '@/instrumentation';
import { schedulerDisabledReason } from '@/server/scheduler';
import { createTestDb, type TestDb } from '../../setup/test-db';

describe('driver selection and env', () => {
  it('uses DATABASE_URL when set, PGlite otherwise', () => {
    expect(databaseUrl({ DATABASE_URL: ' postgres://u:p@h:6543/db ' })).toBe('postgres://u:p@h:6543/db');
    expect(databaseUrl({ DATABASE_URL: '' })).toBeNull();
    expect(databaseUrl({})).toBeNull();
  });

  it("falls back to the Supabase ↔ Vercel integration's POSTGRES_URL and strips its supa= param", () => {
    const pooled =
      'postgres://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x';
    expect(databaseUrl({ POSTGRES_URL: pooled })).toBe(
      'postgres://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require',
    );
    expect(databaseUrl({ DATABASE_URL: 'postgres://a@h/db', POSTGRES_URL: pooled })).toBe(
      'postgres://a@h/db',
    );
  });

  it("migrates through DIRECT_URL, then the integration's non-pooling URL, then the runtime URL", () => {
    expect(
      migrationUrl({ DIRECT_URL: 'postgres://d@h:5432/db', POSTGRES_URL_NON_POOLING: 'postgres://n@h/db' }),
    ).toBe('postgres://d@h:5432/db');
    expect(
      migrationUrl({
        POSTGRES_URL_NON_POOLING: 'postgres://n@h:5432/db?sslmode=require&supa=base-pooler.x',
        POSTGRES_URL: 'postgres://p@h:6543/db',
      }),
    ).toBe('postgres://n@h:5432/db?sslmode=require');
    expect(migrationUrl({ POSTGRES_URL: 'postgres://p@h:6543/db' })).toBe('postgres://p@h:6543/db');
    expect(migrationUrl({})).toBeNull();
  });

  it('keeps the pool tiny on Vercel', () => {
    expect(poolMax({ VERCEL: '1' })).toBe(3);
    expect(poolMax({})).toBe(5);
    expect(poolMax({ DATABASE_POOL_MAX: '9' })).toBe(9);
  });

  it('parses int8 like PGlite does (number when safe, bigint otherwise)', () => {
    expect(parseInt8('42')).toBe(42);
    expect(parseInt8('9007199254740993')).toBe(BigInt('9007199254740993'));
  });

  it('never starts the in-process scheduler on Vercel (Vercel Cron drives /api/cron/tick)', () => {
    expect(shouldStartScheduler({ NEXT_RUNTIME: 'nodejs', VERCEL: '1' })).toBe(false);
    expect(schedulerDisabledReason({ VERCEL: '1' })).toMatch(/Vercel/);
  });

  it('stores file bytes in Supabase Storage only when both Supabase vars are set', () => {
    expect(supabaseStorageConfigured({ SUPABASE_URL: 'https://x.supabase.co' })).toBe(false);
    const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only' };
    expect(supabaseStorageConfigured(env)).toBe(true);
    expect(defaultBlobStorage('/tmp/files', env).kind).toBe('supabase');
    expect(defaultBlobStorage('/tmp/files', {}).kind).toBe('local');
  });

  it('fails clearly on Vercel instead of writing to the read-only disk', async () => {
    await expect(openDatabase({ VERCEL: '1' })).rejects.toThrow(/DATABASE_URL is not set/);
    await expect(
      defaultBlobStorage('/tmp/files', { VERCEL: '1' }).put(
        '00000000-0000-4000-8000-000000000000',
        Buffer.from('x'),
        'text/plain',
      ),
    ).rejects.toThrow(/File storage is not configured/);
  });

  it('recognises a transaction-mode pooler URL (db:migrate skips its session lock there)', () => {
    expect(isTransactionPoolerUrl('postgres://u:p@aws-0-x.pooler.supabase.com:6543/postgres')).toBe(true);
    expect(isTransactionPoolerUrl('postgres://u:p@h:5432/db?pgbouncer=true')).toBe(true);
    expect(isTransactionPoolerUrl('postgres://u:p@db.ref.supabase.co:5432/postgres')).toBe(false);
  });
});

describe('raw result normalisation', () => {
  it('reads rows and affected counts from both driver shapes', () => {
    const pgjs = Object.assign([{ a: 1 }], { count: 3 });
    expect([...rowsOf(pgjs)]).toEqual([{ a: 1 }]);
    expect(rowCount(pgjs)).toBe(3);
    expect(rowsOf({ rows: [{ a: 2 }], affectedRows: 0 })).toEqual([{ a: 2 }]);
    expect(rowCount({ rows: [], affectedRows: 5 })).toBe(5);
  });
});

describe('on PGlite', () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(() => t.close());

  it('enables row level security on every table (Supabase Data API sees nothing)', async () => {
    const res = await t.pg.query<{ name: string }>(
      "SELECT relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity",
    );
    expect(res.rows.map((r) => r.name)).toEqual([]);
  });

  it('creates the runtime-owned tables in a migration, with RLS, so on-demand DDL never adds an open table', async () => {
    const { ensureSchedulerTables } = await import('@/server/scheduler/store');
    const { ensurePackDraftTable } = await import('@/server/repositories/packing-drafts');
    await ensureSchedulerTables(t.db);
    await ensurePackDraftTable(t.db);
    const res = await t.pg.query<{ name: string; rls: boolean }>(
      "SELECT relname AS name, relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND relname IN ('scheduler_lease', 'scheduler_task_runs', 'pack_drafts', 'eod_auto_close_rules') ORDER BY relname",
    );
    expect(res.rows).toEqual([
      { name: 'eod_auto_close_rules', rls: true },
      { name: 'pack_drafts', rls: true },
      { name: 'scheduler_lease', rls: true },
      { name: 'scheduler_task_runs', rls: true },
    ]);
  });

  it('dbAll / dbGet / dbRun normalise results; COUNT is a number; quoted aliases keep camelCase', async () => {
    await t.db.insert(schema.tags).values([
      { name: 'A', color: 'Red' },
      { name: 'B', color: 'Blue' },
    ]);
    const rows = await dbAll<{ tagName: string }>(
      t.db,
      sql`SELECT name AS "tagName" FROM tags ORDER BY name`,
    );
    expect(rows).toEqual([{ tagName: 'A' }, { tagName: 'B' }]);
    expect(await dbGet<{ n: number }>(t.db, sql`SELECT count(*) AS n FROM tags`)).toEqual({ n: 2 });
    expect((await dbRun(t.db, sql`UPDATE tags SET color = 'Green'`)).rowCount).toBe(2);
    expect(rowCount(await t.db.delete(schema.tags).where(eq(schema.tags.name, 'A')))).toBe(1);
  });

  it('withWriteTx holds the app advisory lock and commits', async () => {
    const held = await withWriteTx(t.db, async (tx) => {
      await tx.insert(schema.tags).values({ name: 'Locked', color: 'Red' });
      return dbGet<{ n: number }>(
        tx,
        sql`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = ${WRITE_LOCK_KEY % 2 ** 32} AND granted`,
      );
    });
    expect(held?.n).toBe(1);
    expect(await t.db.select().from(schema.tags)).toHaveLength(1);
    await expect(
      t.db.transaction(async (tx) => {
        await takeWriteLock(tx);
        await takeWriteLock(tx);
      }),
    ).resolves.toBeUndefined();
  });

  it('withWriteTx runs one writer at a time per process and nests without deadlock', async () => {
    const events: string[] = [];
    const writer = (name: string) =>
      withWriteTx(t.db, async (tx) => {
        events.push(`${name}:start`);
        await withWriteTx(tx, async (inner) => {
          await inner.insert(schema.tags).values({ name, color: 'Red' });
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push(`${name}:end`);
      });
    await Promise.all([writer('W1'), writer('W2'), writer('W3')]);
    expect(events).toEqual(['W1:start', 'W1:end', 'W2:start', 'W2:end', 'W3:start', 'W3:end']);
    // A failed writer still passes the turn on.
    await expect(
      withWriteTx(t.db, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(withWriteTx(t.db, async () => 'ok')).resolves.toBe('ok');
  });

  it('takeWriteLock gives up with BUSY (503) when another writer keeps the lock', async () => {
    const stuck = { execute: async () => ({ rows: [{ locked: false }] }) } as unknown as Parameters<
      typeof takeWriteLock
    >[0];
    await expect(takeWriteLock(stuck, 0)).rejects.toMatchObject({ code: 'BUSY', status: 503 });
  });

  it('a caught DB error inside a savepoint leaves the transaction usable', async () => {
    await withWriteTx(t.db, async (tx) => {
      await tx.insert(schema.tags).values({ name: 'Dup', color: 'Red' });
      const failed = await bestEffort(tx, (sp) =>
        sp
          .insert(schema.tags)
          .values({ name: 'Dup', color: 'Red' })
          .then(() => undefined),
      );
      expect(failed.ok).toBe(false);
      if (!failed.ok) {
        expect(pgErrorCode(failed.error)).toBe(PG_UNIQUE_VIOLATION);
        expect(isUniqueViolation(failed.error)).toBe(true);
      }
      await expect(
        inSavepoint(tx, (sp) => sp.insert(schema.tags).values({ name: 'Dup', color: 'Red' })),
      ).rejects.toThrow();
      await tx.insert(schema.tags).values({ name: 'After', color: 'Blue' });
    });
    expect((await t.db.select().from(schema.tags)).map((r) => r.name).sort()).toEqual(['After', 'Dup']);
  });

  it('sequential helpers keep order and run one item at a time', async () => {
    const seen: number[] = [];
    let running = 0;
    const out = await mapSeq([3, 1, 2], async (n) => {
      running += 1;
      expect(running).toBe(1);
      await new Promise((r) => setTimeout(r, n));
      seen.push(n);
      running -= 1;
      return n * 10;
    });
    expect(out).toEqual([30, 10, 20]);
    expect(seen).toEqual([3, 1, 2]);
    expect(await filterSeq([1, 2, 3, 4], async (n) => n % 2 === 0)).toEqual([2, 4]);
  });
});
