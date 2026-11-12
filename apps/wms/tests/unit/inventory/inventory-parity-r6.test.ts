/** M06 round 6 (critic 6.8): txn location text, change-log wording, default reasons, fixture purge, stall notice. */
import { and, eq, or } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import { ledger } from '@/server/domain/ledger';
import {
  attributeChangeLineLabel,
  changeAttributes,
  changeLogValue,
} from '@/server/repositories/inventory-commands';
import { ensureDefaultInventoryReasons } from '@/server/repositories/inventory-lookups';
import { findFixtureStock, purgeFixtureStock } from '@/server/repositories/inventory-hygiene';
import { txnLocationText } from '@/components/inventory/by-location-types';
import { GRID_SLOW_MS, GRID_STALL_MS, gridStallPhase } from '@/components/inventory/inventory-shared';
import { createWorld, locationRow, type World } from '../foundation/domain/fixtures';

describe('bucket drawer transaction location', () => {
  it('never renders a dangling dash arrow for single-sided rows', () => {
    expect(txnLocationText(null, 'MLT1-B-01')).toBe('at MLT1-B-01');
    expect(txnLocationText('MLT1-B-01', null)).toBe('at MLT1-B-01');
    expect(txnLocationText('MLT1-B-01', 'MLT1-B-01')).toBe('at MLT1-B-01');
    expect(txnLocationText('MLT1-A-01', 'MLT1-B-01')).toBe('MLT1-A-01 → MLT1-B-01');
    expect(txnLocationText(null, null)).toBeNull();
    expect(txnLocationText(' ', '')).toBeNull();
  });
});

describe('change-log wording for Change Attributes', () => {
  it('pluralises units and names an empty value', () => {
    expect(attributeChangeLineLabel('MLT-WIDGET-01', 1)).toBe('MLT-WIDGET-01 (1 unit)');
    expect(attributeChangeLineLabel('MLT-WIDGET-01', 1200)).toBe('MLT-WIDGET-01 (1,200 units)');
    expect(changeLogValue(null)).toBe('(none)');
    expect(changeLogValue('  ')).toBe('(none)');
    expect(changeLogValue('Damaged')).toBe('Damaged');
  });

  describe('written row', () => {
    let w: World;
    beforeEach(async () => {
      w = await createWorld();
      await w.db.insert(schema.lookupValues).values({ type: 'damage_reason', name: 'Damaged' });
    });
    afterEach(() => w.close());

    it("reads 'SKU (1 unit) -> Damage Reason is modified. (none) --> Damaged'", async () => {
      const b = (
        await ledger.add(w.db, w.ctx, {
          warehouseId: w.warehouseId,
          clientId: w.clientId,
          productId: w.productId,
          locationId: w.loc.storageA,
          qty: 4,
        })
      ).bucket;
      const ctx = { ...w.ctx, scope: { warehouseIds: [w.warehouseId], clientIds: 'all' as const } };
      const res = await changeAttributes(w.db, ctx, {
        ids: [b.id],
        attribute: 'damageReason',
        value: 'Damaged',
        qty: 1,
      });
      expect(res.failed).toEqual([]);
      const row = (
        await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.field, 'damageReason')).limit(1)
      )[0];
      expect(row?.message).toMatch(/^\S+ \(1 unit\) -> Damage Reason is modified\. \(none\) --> Damaged$/);
      expect(row?.message).not.toContain('  ');
    });
  });
});

describe('default reasons for existing tenants', () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
  });
  afterEach(() => w.close());

  const reasons = async () =>
    await w.db.select().from(schema.lookupValues).where(eq(schema.lookupValues.type, 'adjustment_reason'));

  it('adds Found (increase), Import and Damaged (decrease) once, and keeps a deactivated value deactivated', async () => {
    await w.db
      .insert(schema.lookupValues)
      .values({ type: 'adjustment_reason', name: 'Import', isActive: false });
    const added = await ensureDefaultInventoryReasons(w.db);
    expect(added).toEqual(['adjustment_reason:Found', 'adjustment_reason:Damaged', 'damage_reason:Damaged']);
    expect(await ensureDefaultInventoryReasons(w.db)).toEqual([]);
    const found = (await reasons()).find((r) => r.name === 'Found');
    expect(found?.meta).toEqual({ direction: 'increase' });
    expect((await reasons()).find((r) => r.name === 'Damaged')?.meta).toEqual({ direction: 'decrease' });
    expect((await reasons()).find((r) => r.name === 'Import')?.isActive).toBe(false);
  });
});

describe('test-fixture stock purge', () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
  });
  afterEach(() => w.close());

  it('removes idle free stock in KS-CRIT locations through the ledger and keeps allocated units', async () => {
    const crit = (
      await w.db
        .insert(schema.locations)
        .values(locationRow(w.warehouseId, 'KS-CRIT-R4W20005', { areaType: 'Storage' }))
        .returning()
    )[0].id;
    const fixture = (
      await ledger.add(w.db, w.ctx, {
        warehouseId: w.warehouseId,
        clientId: w.clientId,
        productId: w.productId,
        locationId: crit,
        qty: 5,
      })
    ).bucket;
    const real = (
      await ledger.add(w.db, w.ctx, {
        warehouseId: w.warehouseId,
        clientId: w.clientId,
        productId: w.productId,
        locationId: w.loc.storageA,
        qty: 7,
      })
    ).bucket;
    await ledger.allocate(w.db, w.ctx, { inventoryId: fixture.id, qty: 2 });

    const now = new Date(Date.now() + 2 * 60 * 60_000);
    expect(await findFixtureStock(w.db, new Date(), 60)).toEqual([]); // just touched: a running suite keeps it
    expect((await findFixtureStock(w.db, now, 60)).map((f) => f.location)).toEqual(['KS-CRIT-R4W20005']);

    const res = await purgeFixtureStock(w.db, w.ctx, now, 60);
    expect(res).toMatchObject({ removed: 1, units: 3 });
    const left = (
      await w.db.select().from(schema.inventory).where(eq(schema.inventory.id, fixture.id)).limit(1)
    )[0];
    expect(left).toMatchObject({ onHand: 2, allocated: 2 });
    expect(
      (await w.db.select().from(schema.inventory).where(eq(schema.inventory.id, real.id)).limit(1))[0]
        ?.onHand,
    ).toBe(7);
    const t = schema.inventoryTransactions;
    const adj = await w.db
      .select()
      .from(t)
      .where(
        and(
          eq(t.type, 'Inventory Adjustment'),
          or(eq(t.fromInventoryId, fixture.id), eq(t.toInventoryId, fixture.id)),
        ),
      );
    expect(adj.filter((r) => r.note === 'Test fixture purge')).toHaveLength(1);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);

    // Second run: only allocated units remain, so it reports them and changes nothing.
    const again = await purgeFixtureStock(w.db, w.ctx, now, 60);
    expect(again.removed).toBe(0);
    expect(again.skipped[0]?.message).toMatch(/2 allocated unit/);
  });
});

describe('stalled grid notice', () => {
  it('escalates from slow to stalled only while loading', () => {
    expect(gridStallPhase(true, 0)).toBe('ok');
    expect(gridStallPhase(true, GRID_SLOW_MS)).toBe('slow');
    expect(gridStallPhase(true, GRID_STALL_MS)).toBe('stalled');
    expect(gridStallPhase(false, GRID_STALL_MS * 10)).toBe('ok');
  });
});
