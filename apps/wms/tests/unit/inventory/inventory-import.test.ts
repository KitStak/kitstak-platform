/** M06 Import Inventory handler: posts Inventory Adjustment with reason "Import"; per-row validation. */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { ledger } from '@/server/domain/ledger';
import { handler } from '@/server/imports/handlers/inventory';
import type { ImportApplyContext } from '@/server/imports/types';
import { createWorld, locationRow, type World } from '../foundation/domain/fixtures';

let w: World;
let ctx: ImportApplyContext;
let importReasonId: string;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
  const auth = {
    scope,
    viewScope: scope,
    permissions: new Set<string>(),
    user: { id: w.userId },
    context: { warehouseId: null, clientId: null },
  } as unknown as AuthContext;
  ctx = { db: w.db, auth, actor: { userId: w.userId, source: 'admin@test.io' }, batchId: 'b1', rowNumber: 2 };
  importReasonId = (
    await w.db.insert(schema.lookupValues).values({ type: 'adjustment_reason', name: 'Import' }).returning()
  )[0].id;
  await w.db.insert(schema.lookupValues).values({ type: 'damage_reason', name: 'Crushed' });
});
afterEach(() => w.close());

const row = (extra: Record<string, string | number | null> = {}) => ({
  warehouseCode: 'MLT1',
  clientCode: 'ACME',
  sku: 'MLT-WIDGET-01',
  locationCode: 'A-01-01',
  quantity: 12,
  ...extra,
});

describe('Import Inventory handler', () => {
  it('adds stock as Inventory Adjustment with reason Import', async () => {
    const res = await handler.apply(ctx, row());
    expect(res.message).toBe('Added 12 × MLT-WIDGET-01 to A-01-01');
    const txn = (await w.db.select().from(schema.inventoryTransactions)).at(-1);
    expect(txn).toMatchObject({
      type: 'Inventory Adjustment',
      adjustmentReasonId: importReasonId,
      uomQty: 12,
    });
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it('stores damage reason and lot attributes', async () => {
    await w.db
      .update(schema.products)
      .set({ trackLot: true })
      .where(eq(schema.products.sku, 'MLT-WIDGET-01'));
    const res = await handler.apply(
      ctx,
      row({ status: 'Damaged', damageReason: 'Crushed', lotNumber: 'L9' }),
    );
    const b = (
      await w.db
        .select()
        .from(schema.inventory)
        .where(eq(schema.inventory.id, res.entityId ?? ''))
        .limit(1)
    )[0];
    expect(b).toMatchObject({ damageReason: 'Crushed', lotNumber: 'L9', damaged: 12 });
  });

  it('refuses attributes the product does not track, and impossible dates', async () => {
    await expect(async () => await handler.apply(ctx, row({ lotNumber: 'L9' }))).rejects.toThrow(
      "doesn't track lot/batch numbers",
    );
    await expect(async () => await handler.apply(ctx, row({ expiryDate: '2027-01-01' }))).rejects.toThrow(
      /doesn't track expiry dates/,
    );
    await w.db
      .update(schema.products)
      .set({ trackExpiry: true })
      .where(eq(schema.products.sku, 'MLT-WIDGET-01'));
    await expect(async () => await handler.apply(ctx, row({ expiryDate: '2026-02-31' }))).rejects.toThrow(
      /not a real date/,
    );
    await expect(async () => await handler.apply(ctx, row({ expiryDate: '2026-13-45' }))).rejects.toThrow(
      /not a real date/,
    );
    const res = await handler.apply(ctx, row({ expiryDate: '2027/1/5' }));
    expect(
      (
        await w.db
          .select()
          .from(schema.inventory)
          .where(eq(schema.inventory.id, res.entityId ?? ''))
          .limit(1)
      )[0]?.expiryDate,
    ).toBe('2027-01-05');
  });

  it('fails a row with a clear message', async () => {
    await expect(async () => await handler.apply(ctx, row({ warehouseCode: 'NOPE' }))).rejects.toThrow(
      'Warehouse "NOPE" was not found',
    );
    await expect(async () => await handler.apply(ctx, row({ sku: 'X' }))).rejects.toThrow(
      /SKU "X" was not found/,
    );
    await expect(async () => await handler.apply(ctx, row({ locationCode: 'Z-9' }))).rejects.toThrow(
      /Location "Z-9" was not found/,
    );
    await expect(async () => await handler.apply(ctx, row({ quantity: 0 }))).rejects.toThrow(
      /positive whole number/,
    );
    await expect(async () => await handler.apply(ctx, row({ status: 'Damaged' }))).rejects.toThrow(
      /Damage Reason is required/,
    );
  });

  it('applies the only-one-SKU rule with the rule message', async () => {
    await w.db.insert(schema.locations).values(locationRow(w.warehouseId, 'MLT1-A-01', { onlyOneSku: true }));
    await handler.apply(ctx, row({ locationCode: 'MLT1-A-01', sku: 'MLT-GADGET-02' }));
    await expect(async () => await handler.apply(ctx, row({ locationCode: 'MLT1-A-01' }))).rejects.toThrow(
      'Location MLT1-A-01 allows only 1 SKU (holds MLT-GADGET-02).',
    );
  });
});
