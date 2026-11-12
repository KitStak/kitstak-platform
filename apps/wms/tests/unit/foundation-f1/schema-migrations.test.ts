import { afterEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { eq, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@/server/db/schema';
import { LEGACY_BUCKET_KEY_PREFIX } from '@/server/db/schema';
import { applyMigrations } from '@/server/db/migrate';
import { openPglite } from '@/server/db';
import { pgErrorCode, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from '@/server/db/sql';
import { createTestDb, type TestDb } from '../../setup/test-db';

async function tableNames(pg: PGlite): Promise<Set<string>> {
  const res = await pg.query<{ name: string }>(
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'",
  );
  return new Set(res.rows.map((r) => r.name));
}

async function indexNames(pg: PGlite): Promise<Set<string>> {
  const res = await pg.query<{ name: string }>(
    "SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'",
  );
  return new Set(res.rows.map((r) => r.name));
}

async function rejection(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('expected a rejection');
}

const schemaTables: PgTable[] = (Object.values(schema) as unknown[]).flatMap((v) =>
  is(v, PgTable) ? [v] : [],
);

describe('F1 schema migrations', () => {
  let testDb: TestDb | undefined;
  afterEach(async () => {
    await testDb?.close();
    testDb = undefined;
  });

  it('creates every table exported from the schema barrel', async () => {
    testDb = await createTestDb();
    const created = await tableNames(testDb.pg);
    const missing = schemaTables.map((t) => getTableName(t)).filter((name) => !created.has(name));
    expect(missing).toEqual([]);
    expect(schemaTables.length).toBeGreaterThanOrEqual(110);
  });

  it('creates the specified ledger, outbound and platform indexes', async () => {
    testDb = await createTestDb();
    const indexes = await indexNames(testDb.pg);
    for (const name of [
      'inventory_bucket_idx',
      'itx_seq_idx',
      'alloc_order_idx',
      'orders_code_idx',
      'change_log_entity_idx',
      'lookup_unique_idx',
      'tasks_no_idx',
      'receipts_master_idx',
      'serial_unique_idx',
    ]) {
      expect(indexes.has(name), name).toBe(true);
    }
  });

  it('is idempotent when re-run on a migrated database', async () => {
    const handle = await openPglite(null, { migrate: false });
    try {
      const first = await applyMigrations(handle.db);
      const second = await applyMigrations(handle.db);
      expect(first.applied).toBe(first.total);
      expect(second.applied).toBe(0);
    } finally {
      await handle.close();
    }
  });

  it('enables row level security on every table (Supabase Data API sees nothing)', async () => {
    testDb = await createTestDb();
    const res = await testDb.pg.query<{ name: string }>(
      "SELECT relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity",
    );
    expect(res.rows.map((r) => r.name)).toEqual([]);
  });

  it('enforces foreign keys and cascades', async () => {
    testDb = await createTestDb();
    const { db } = testDb;
    const fk = await rejection(() =>
      db
        .insert(schema.customers)
        .values({ clientId: 'missing', firstName: 'A', lastName: 'B', email: 'a@b.c', phone: '1' }),
    );
    expect(pgErrorCode(fk)).toBe(PG_FOREIGN_KEY_VIOLATION);

    await db.insert(schema.roles).values({ id: 'r1', key: 'admin', name: 'Admin' });
    await db.insert(schema.rolePermissions).values({ roleId: 'r1', permission: 'orders.read' });
    await db.delete(schema.roles).where(eq(schema.roles.id, 'r1'));
    expect(await db.select().from(schema.rolePermissions)).toEqual([]);
  });

  it('applies column defaults: stamps, JSON objects, legacy bucket keys', async () => {
    testDb = await createTestDb();
    const { db } = testDb;
    await db
      .insert(schema.warehouses)
      .values({ id: 'wh1', code: 'W1', name: 'W1', addressLine: '1 Main', city: 'X', state: 'KY' });
    await db.insert(schema.clients).values({
      id: 'c1',
      code: 'C1',
      name: 'Client',
      contactName: 'n',
      contactEmail: 'e',
      phone: 'p',
      billingPlan: 'monthly',
      status: 'Active',
    });
    const client = (await db.select().from(schema.clients).where(eq(schema.clients.id, 'c1')).limit(1))[0];
    expect(client?.settings).toEqual({});
    expect(client?.customFields).toEqual({});
    expect(client?.version).toBe(1);
    expect(client?.currency).toBe('USD');
    expect(Date.parse(client?.createdAt ?? '')).not.toBeNaN();

    await db.insert(schema.products).values({
      id: 'p1',
      clientId: 'c1',
      sku: 'S',
      barcode: 'B',
      name: 'N',
      category: 'C',
      weightOz: 1,
      lengthIn: 1,
      widthIn: 1,
      heightIn: 1,
      price: 1,
      status: 'Active',
    });
    await db.insert(schema.locations).values({
      id: 'l1',
      warehouseId: 'wh1',
      code: 'A',
      zone: 'A',
      aisle: '1',
      bay: '1',
      level: '1',
      type: 'Picking',
      capacityUnits: 10,
    });
    await db.insert(schema.inventory).values([
      {
        warehouseId: 'wh1',
        productId: 'p1',
        locationId: 'l1',
        onHand: 5,
        receivedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        warehouseId: 'wh1',
        productId: 'p1',
        locationId: 'l1',
        onHand: 3,
        receivedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const rows = await db.select().from(schema.inventory);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.bucketKey.startsWith(LEGACY_BUCKET_KEY_PREFIX))).toBe(true);
    expect(rows.every((r) => r.status === 'Stock' && r.packType === 'Each')).toBe(true);
  });

  it('rejects duplicate global lookup values (NULL scope is not distinct)', async () => {
    testDb = await createTestDb();
    const { db } = testDb;
    await db.insert(schema.lookupValues).values({ type: 'damage_reason', name: 'Crushed' });
    const dup = await rejection(() =>
      db.insert(schema.lookupValues).values({ type: 'damage_reason', name: 'Crushed' }),
    );
    expect(pgErrorCode(dup)).toBe(PG_UNIQUE_VIOLATION);
  });
});
