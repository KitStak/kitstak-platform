/** M13 round 6 (parity loop): Inventory Aging + Location Utilization reports, hub catalog. */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { ledger } from '@/server/domain/ledger';
import { EMPTY_GRID_QUERY, parseGridQuery, type GridQuery } from '@/server/query/grid-query';
import {
  ageInDays,
  agingBucketOf,
  utilizationBand,
  utilizationPct,
  AGING_DEF,
  UTILIZATION_DEF,
} from '@/lib/grid-defs/reports/analysis';
import { listAging, listUtilization } from '@/server/repositories/reports-analysis';
import { REPORT_CATALOG, analysisGroup } from '@/lib/grid-defs/reports/catalog';
import { sortableOf } from '@/lib/grid-defs/reports/types';
import { createWorld, type World } from '../foundation/domain/fixtures';

describe('aging helpers', () => {
  it('buckets ages on inclusive upper bounds', () => {
    expect(agingBucketOf(0)).toBe('0-30 Days');
    expect(agingBucketOf(30)).toBe('0-30 Days');
    expect(agingBucketOf(31)).toBe('31-60 Days');
    expect(agingBucketOf(90)).toBe('61-90 Days');
    expect(agingBucketOf(181)).toBe('181-365 Days');
    expect(agingBucketOf(366)).toBe('Over 365 Days');
  });
  it('ages in whole days, never negative', () => {
    const now = new Date('2026-11-09T12:00:00Z');
    expect(ageInDays('2026-11-01T12:00:00Z', now)).toBe(8);
    expect(ageInDays('2026-12-01T00:00:00Z', now)).toBe(0);
    expect(ageInDays('garbage', now)).toBe(0);
  });
});

describe('utilization helpers', () => {
  it('computes percent and bands', () => {
    expect(utilizationPct(50, 200)).toBe(25);
    expect(utilizationPct(5, 0)).toBeNull();
    expect(utilizationBand(0, 100)).toBe('Empty');
    expect(utilizationBand(10, 100)).toBe('Low');
    expect(utilizationBand(25, 100)).toBe('Healthy');
    expect(utilizationBand(85, 100)).toBe('Near Full');
    expect(utilizationBand(100, 100)).toBe('Near Full');
    expect(utilizationBand(101, 100)).toBe('Over Capacity');
    expect(utilizationBand(4, 0)).toBe('No Capacity Set');
    expect(utilizationBand(0, 0)).toBe('Empty');
  });
  it('every column is sortable and the defaults sort by a real column', () => {
    for (const def of [AGING_DEF, UTILIZATION_DEF]) {
      const s = new Set(sortableOf(def));
      for (const t of def.defaultSort) expect(s.has(t.replace(/^-/, ''))).toBe(true);
      expect(s.has(def.rowKey) || def.rowKey === 'rowId').toBe(true);
    }
  });
});

describe('hub catalog', () => {
  it('lists the analysis reports once', () => {
    const hrefs = REPORT_CATALOG.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs.filter((h) => h === '/reports/inventory-aging')).toHaveLength(1);
    expect(hrefs.filter((h) => h === '/reports/location-utilization')).toHaveLength(1);
  });
  it('drops an analysis report once the menu already carries it', () => {
    const menu = [
      {
        heading: 'X',
        icon: REPORT_CATALOG[0]!.icon,
        items: [
          {
            label: 'A',
            href: '/reports/inventory-aging',
            permission: [],
            description: '',
            group: 'X',
            aliases: [],
          },
        ],
      },
    ];
    expect(analysisGroup(menu)[0]?.items.map((i) => i.href)).toEqual([
      '/reports/location-utilization',
      '/reports/order-lines',
    ]);
  });
});

describe('aging + utilization queries', () => {
  let w: World;
  let auth: AuthContext;
  const q = (qs = ''): GridQuery => ({ ...EMPTY_GRID_QUERY, ...parseGridQuery(qs).query, pageSize: 100 });
  beforeEach(async () => {
    w = await createWorld();
    const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
    auth = {
      scope,
      viewScope: scope,
      permissions: new Set<string>(),
      restrictions: [],
      user: { id: w.userId },
      context: { warehouseId: null, clientId: null },
    } as unknown as AuthContext;
  });
  afterEach(() => w.close());

  const stock = async (qty: number, locationId: string, clientId = w.clientId, productId = w.productId) =>
    (await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId, productId, locationId, qty }))
      .bucket;

  it('ages buckets from received date and filters by bucket', async () => {
    const old = await stock(10, w.loc.storageA);
    await stock(4, w.loc.storageB);
    const past = new Date(Date.now() - 100 * 86_400_000).toISOString();
    await w.db.update(schema.inventory).set({ receivedAt: past }).where(eq(schema.inventory.id, old.id));
    const page = await listAging(w.db, auth, q());
    expect(page.total).toBe(2);
    expect(page.rows[0]).toMatchObject({ onHand: 10, agingBucket: '91-180 Days' });
    expect(Number(page.rows[0]?.ageDays)).toBeGreaterThanOrEqual(99);
    expect((await listAging(w.db, auth, q('f.agingBucket=eq:0-30%20Days'))).total).toBe(1);
    const other = { warehouseIds: ['nope'], clientIds: 'all' as const };
    expect((await listAging(w.db, { ...auth, viewScope: other } as AuthContext, q())).total).toBe(0);
  });

  it("measures each location against its capacity and hides other clients' units", async () => {
    await w.db
      .update(schema.locations)
      .set({ capacityUnits: 10, maxCapacityQty: 0 })
      .where(eq(schema.locations.id, w.loc.storageA));
    await stock(12, w.loc.storageA);
    const betaProduct = (
      await w.db
        .insert(schema.products)
        .values({
          clientId: w.otherClientId,
          sku: 'BETA-01',
          barcode: 'BETA-01',
          name: 'Beta',
          category: 'General',
          weightOz: 1,
          lengthIn: 1,
          widthIn: 1,
          heightIn: 1,
          price: 1,
          status: 'Active',
        })
        .returning()
    )[0].id;
    await stock(5, w.loc.storageA, w.otherClientId, betaProduct);
    const row = async (a: AuthContext) =>
      (await listUtilization(w.db, a, q())).rows.find((r) => r.rowId === w.loc.storageA);
    expect(await row(auth)).toMatchObject({
      usedQty: 17,
      capacity: 10,
      band: 'Over Capacity',
      freeQty: 0,
      skuCount: 2,
    });
    const scoped = { warehouseIds: [w.warehouseId], clientIds: [w.clientId] };
    expect(await row({ ...auth, viewScope: scoped } as AuthContext)).toMatchObject({
      usedQty: 12,
      utilizationPct: 120,
    });
    expect((await listUtilization(w.db, auth, q('f.band=eq:Over%20Capacity'))).total).toBe(1);
  });
});
