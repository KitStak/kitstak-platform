/**
 * The free stock move (docs/programs/SPEC.md 6.3): `freeStockRows` now runs the shared
 * `freeStockSql` from @kitstak/db/wms-free-stock. This snapshot runs the seed tenant's warehouse
 * through the OLD query (kept here verbatim as the reference: Drizzle query builder over the WMS
 * schema with the foundation's `notCountLocked`) and through the new one, with every filter the
 * callers use, and asserts the rows are identical. It also checks a Projects style read (plain
 * connection, explicit schema) returns the same rows.
 *
 * Runs against DATABASE_URL (Postgres); skips when it does not answer or WMS is not migrated.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COUNT_LOCKING_PLAN_STATUSES, COUNT_RELEASED_LINE_STATUSES, freeStockRows as sharedFreeStockRows } from '@kitstak/db/wms-free-stock';
import * as schema from '@/server/db/schema';
import { LOCKING_PLAN_STATUSES, notCountLocked, RELEASED_LINE_STATUSES } from '@/server/domain/ledger/count-locks';
import type { Tx } from '@/server/domain/types';
import { freeStockRows, type FreeStockFilter, type FreeStockRow } from './work-orders-availability';

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const text = readFileSync(path.resolve(__dirname, '../../../.env.local'), 'utf8');
    const line = text.split('\n').find((row) => row.startsWith('DATABASE_URL='));
    return line ? line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '') : '';
  } catch {
    return '';
  }
}

/** The pre-move `freeStockRows`, unchanged, as the reference. */
async function oldFreeStockRows(db: Tx, filter: FreeStockFilter = {}): Promise<FreeStockRow[]> {
  const i = schema.inventory;
  const l = schema.locations;
  if (filter.productIds && filter.productIds.length === 0) return [];
  const rows = await db
    .select({
      warehouseId: i.warehouseId,
      clientId: i.clientId,
      productId: i.productId,
      locationId: i.locationId,
      free: sql<number>`${i.onHand} - ${i.allocated}`,
      locked: l.isLocked,
      prevent: l.preventAllocation,
      countLocked: sql<number>`CASE WHEN ${notCountLocked(i.locationId)} THEN 0 ELSE 1 END`,
    })
    .from(i)
    .innerJoin(l, eq(l.id, i.locationId))
    .where(
      and(
        filter.productIds ? inArray(i.productId, [...new Set(filter.productIds)]) : undefined,
        filter.warehouseId ? eq(i.warehouseId, filter.warehouseId) : undefined,
        filter.clientId ? eq(i.clientId, filter.clientId) : undefined,
        eq(i.status, 'Stock'),
        sql`${i.damageReason} IS NULL`,
        gt(sql`${i.onHand} - ${i.allocated}`, 0),
      ),
    );
  return rows.map((r) => ({
    warehouseId: r.warehouseId,
    clientId: r.clientId,
    productId: r.productId,
    locationId: r.locationId,
    free: Number(r.free),
    locationLocked: Boolean(r.locked),
    preventAllocation: Boolean(r.prevent),
    countLocked: Number(r.countLocked) === 1,
  }));
}

const key = (row: FreeStockRow): string =>
  [row.warehouseId, row.clientId ?? '', row.productId, row.locationId, row.free, row.locationLocked, row.preventAllocation, row.countLocked].join('|');
const sorted = (rows: readonly FreeStockRow[]): string[] => rows.map(key).sort();

const url = databaseUrl();
let client: postgres.Sql | null = null;
let ready = false;
let notReady = 'DATABASE_URL is not set';
if (url) {
  try {
    client = postgres(url, { max: 2, prepare: false, onnotice: () => {}, connection: { search_path: 'wms, public' } });
    const [row] = await client`select to_regclass('wms.inventory') is not null as ok, to_regclass('wms.count_plan_lines') is not null as plans`;
    ready = row?.ok === true && row?.plans === true;
    if (!ready) notReady = 'the WMS schema is not migrated (run db:migrate)';
  } catch (error) {
    ready = false;
    notReady = `the database does not answer (${error instanceof Error ? error.message : String(error)})`;
  }
}
if (!ready) {
  // Never skipped silently: CI (or REQUIRE_DB=1) fails, anywhere else a loud warning.
  const message = `DATABASE TESTS SKIPPED: free stock snapshot, ${notReady}.`;
  if (process.env.CI === 'true' || process.env.REQUIRE_DB === '1') throw new Error(message);
  process.stderr.write(`\n\u001b[33m!!! ${message} !!!\u001b[0m\n\n`);
}

describe('free stock count lock rule matches WMS notCountLocked', () => {
  it('uses the same plan and line statuses as count-locks.ts', () => {
    expect([...COUNT_LOCKING_PLAN_STATUSES]).toEqual([...LOCKING_PLAN_STATUSES]);
    expect([...COUNT_RELEASED_LINE_STATUSES]).toEqual([...RELEASED_LINE_STATUSES]);
  });

  it('uses the same statuses in the notCountLocked SQL text', () => {
    const text = new PgDialect().sqlToQuery(notCountLocked(schema.inventory.locationId)).sql;
    for (const status of [...LOCKING_PLAN_STATUSES, ...RELEASED_LINE_STATUSES]) expect(text).toContain(`'${status}'`);
  });
});

describe.skipIf(!ready)('free stock move: old and new rows are identical (seed tenant)', () => {
  let db: Tx;
  let products: string[] = [];
  let warehouseId = '';
  let clientId: string | null = null;

  beforeAll(async () => {
    db = drizzle(client as postgres.Sql, { schema }) as unknown as Tx;
    const sample = await client!<{ product_id: string; warehouse_id: string; client_id: string | null }[]>`
      select product_id, warehouse_id, client_id from wms.inventory
       where status = 'Stock' and damage_reason is null and on_hand - allocated > 0
       order by on_hand - allocated desc, product_id limit 12`;
    products = [...new Set(sample.map((row) => row.product_id))];
    warehouseId = sample[0]?.warehouse_id ?? '';
    clientId = sample[0]?.client_id ?? null;
  });
  afterAll(async () => {
    await client?.end();
  });

  it('has seeded free stock to compare', () => {
    expect(products.length).toBeGreaterThan(0);
  });

  it('every bucket of the warehouse (Kit Inventory stats)', async () => {
    const before = await oldFreeStockRows(db);
    const after = await freeStockRows(db);
    expect(after.length).toBe(before.length);
    expect(sorted(after)).toEqual(sorted(before));
  });

  it('by product, warehouse and client (work order components and the kit card)', async () => {
    const filters: FreeStockFilter[] = [
      { productIds: products },
      { productIds: [...products, ...products] },
      { productIds: products, warehouseId },
      { productIds: products, warehouseId, clientId },
      { warehouseId, clientId },
      { productIds: ['no-such-product'] },
      { productIds: [] },
    ];
    for (const filter of filters) {
      expect(sorted(await freeStockRows(db, filter))).toEqual(sorted(await oldFreeStockRows(db, filter)));
    }
  });

  it('a Projects style read with an explicit schema returns the same rows', async () => {
    const plain = postgres(url, { max: 1, prepare: false, onnotice: () => {}, connection: { search_path: 'public' } });
    try {
      const projectsDb = drizzle(plain);
      const shared = await sharedFreeStockRows(projectsDb, 'wms', { productIds: products });
      expect(sorted(shared)).toEqual(sorted(await oldFreeStockRows(db, { productIds: products })));
    } finally {
      await plain.end();
    }
  });
});
