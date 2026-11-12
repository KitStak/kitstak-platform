/**
 * M08 round 2 (parity loop): count-lock aware sources, Create Kit source confirmation,
 * human change-log values, edit after Completed with core fields locked.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import { suggestSource } from '@/lib/grid-defs/work-orders/source-suggest';
import { coreLocked, editReason } from '@/lib/grid-defs/work-orders/work-order-model';
import { listStockBucketsFor } from '@/server/repositories/kits';
import {
  createWorkOrder,
  formatLogValue,
  getWorkOrderDetail,
  updateWorkOrder,
} from '@/server/repositories/work-orders';
import { createKit } from '@/server/repositories/work-orders-commands';
import { createKitWorld, stock, woInput, type KitWorld } from './kit-world';

let w: KitWorld;
beforeEach(async () => {
  w = await createKitWorld();
  await stock(w, w.productId, 30);
  await stock(w, w.product2Id, 12);
});
afterEach(() => w.close());

const errOf = async (
  fn: () => unknown,
): Promise<{ code?: string; fieldErrors?: Record<string, string[]>; message?: string } | undefined> => {
  try {
    await fn();
  } catch (error) {
    return error as { code?: string; fieldErrors?: Record<string, string[]>; message?: string };
  }
  return undefined;
};

async function lockLocation(locationId: string, code = 'CNT-TEST-1'): Promise<void> {
  const plan = (
    await w.db
      .insert(schema.countPlans)
      .values({
        code,
        warehouseId: w.warehouseId,
        scheduledAt: new Date().toISOString(),
        lockLocations: true,
        countType: 'Location',
        status: 'Ready To Count',
      })
      .returning()
  )[0];
  await w.db.insert(schema.countPlanLines).values({ planId: plan.id, locationId, status: 'Pending' });
}

describe('count-lock aware component sources', () => {
  it('flags locked buckets in one batched lookup and never suggests them', async () => {
    await stock(w, w.productId, 50, w.loc.storageB);
    await lockLocation(w.loc.storageA);
    const all = await listStockBucketsFor(w.db, w.scope, {
      productIds: [w.productId, w.product2Id],
      warehouseId: w.warehouseId,
      clientId: w.clientId,
    });
    const widget = all[w.productId] ?? [];
    expect(widget.find((b) => b.locationId === w.loc.storageA)?.lockedBy).toBe('CNT-TEST-1');
    expect(widget.find((b) => b.locationId === w.loc.storageB)?.lockedBy).toBeNull();
    expect(suggestSource(widget, 10)?.locationId).toBe(w.loc.storageB);
    // Only locked stock for the gadget: nothing to suggest.
    expect(suggestSource(all[w.product2Id] ?? [], 5)).toBeNull();
  });

  it('rejects create with a count-locked source and names the component path', async () => {
    await lockLocation(w.loc.storageA);
    const err = await errOf(async () => await createWorkOrder(w.db, w.wctx, woInput(w)));
    expect(err?.code).toBe('VALIDATION');
    const [path, messages] = Object.entries(err?.fieldErrors ?? {})[0] ?? [];
    expect(path).toMatch(/^components\.\d\.locationId$/);
    expect(messages?.[0]).toMatch(/locked by count plan CNT-TEST-1/);
  });

  it('does not block editing notes when an unchanged source got locked later', async () => {
    const wo = await createWorkOrder(w.db, w.wctx, woInput(w));
    await lockLocation(w.loc.storageA);
    const after = await updateWorkOrder(
      w.db,
      w.wctx,
      wo.id,
      wo.version,
      woInput(w, { extraNote: 'Pack with care' }),
    );
    expect(after.extraNote).toBe('Pack with care');
    expect(
      (await getWorkOrderDetail(w.db, w.scope, wo.id)).components.every(
        (c) => c.sourceLockedBy === 'CNT-TEST-1',
      ),
    ).toBe(true);
  });
});

describe('Create Kit source confirmation (Logiwa step 1)', () => {
  it('refuses a scan that is not a component source and accepts the chosen location', async () => {
    const wo = await createWorkOrder(w.db, w.wctx, woInput(w, { requestedQty: 2 }));
    const storageA = (
      await w.db.select().from(schema.locations).where(eq(schema.locations.id, w.loc.storageA)).limit(1)
    )[0];
    const bad = await errOf(
      async () =>
        await createKit(w.db, w.wctx, {
          workOrderId: wo.id,
          qty: 1,
          locationId: w.kittingLocId,
          lpId: null,
          lotNumber: null,
          expiryDate: null,
          productionDate: null,
          sourceScan: 'NOPE-99',
        }),
    );
    expect(bad?.code).toBe('VALIDATION');
    expect(bad?.message).toMatch(/not a source/);
    const ok = await createKit(w.db, w.wctx, {
      workOrderId: wo.id,
      qty: 1,
      locationId: w.kittingLocId,
      lpId: null,
      lotNumber: null,
      expiryDate: null,
      productionDate: null,
      sourceScan: storageA?.code.toLowerCase() ?? '',
    });
    expect(ok.processedQty).toBe(1);
  });
});

describe('change log values', () => {
  it('formats ISO dates in the warehouse timezone and leaves other values alone', () => {
    expect(formatLogValue('2026-11-10T03:09:52.527Z', 'America/Chicago')).toBe('11/09/2026 09:09 PM CST');
    expect(formatLogValue('KIT-01', 'America/Chicago')).toBe('KIT-01');
    expect(formatLogValue(5, 'America/Chicago')).toBe(5);
  });

  it('logs Actual start date with a human label and a local value on Create Kit', async () => {
    const wo = await createWorkOrder(w.db, w.wctx, woInput(w, { requestedQty: 2 }));
    await createKit(w.db, w.wctx, {
      workOrderId: wo.id,
      qty: 1,
      locationId: w.kittingLocId,
      lpId: null,
      lotNumber: null,
      expiryDate: null,
      productionDate: null,
      actualStartAt: '2026-11-10T03:09:52.527Z',
    });
    const rows = await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, wo.id));
    const start = rows.find((r) => r.field === 'actualStartAt');
    expect(start?.fieldLabel).toBe('Actual start date');
    expect(start?.message).not.toMatch(/T\d{2}:\d{2}/);
    expect(rows.find((r) => r.field === 'processedQty')?.fieldLabel).toBe('Processed quantity');
  });
});

describe('edit after Completed (Logiwa Show Details drawer)', () => {
  it('allows notes on a Completed work order but keeps core fields and sources locked', async () => {
    const wo = await createWorkOrder(w.db, w.wctx, woInput(w, { requestedQty: 1 }));
    await createKit(w.db, w.wctx, {
      workOrderId: wo.id,
      qty: 1,
      locationId: w.kittingLocId,
      lpId: null,
      lotNumber: null,
      expiryDate: null,
      productionDate: null,
    });
    const done = (
      await w.db.select().from(schema.workOrders).where(eq(schema.workOrders.id, wo.id)).limit(1)
    )[0];
    expect(done?.status).toBe('Completed');
    expect(
      editReason({ status: 'Completed', processedQty: 1, requestedQty: 1, type: done!.type } as never),
    ).toBeNull();
    expect(coreLocked({ status: 'Completed' })).toBe(true);
    const edited = await updateWorkOrder(
      w.db,
      w.wctx,
      wo.id,
      done!.version,
      woInput(w, { requestedQty: 1, extraNote: 'QA passed' }),
    );
    expect(edited.extraNote).toBe('QA passed');
    expect(
      (
        await errOf(
          async () =>
            await updateWorkOrder(w.db, w.wctx, wo.id, edited.version, woInput(w, { requestedQty: 3 })),
        )
      )?.code,
    ).toBe('INVALID_STATE');
    await stock(w, w.productId, 5, w.loc.storageB);
    const moved = woInput(w, {
      requestedQty: 1,
      components: [
        { componentProductId: w.productId, locationId: w.loc.storageB },
        { componentProductId: w.product2Id, locationId: w.loc.storageA },
      ],
    });
    expect(
      (await errOf(async () => await updateWorkOrder(w.db, w.wctx, wo.id, edited.version, moved)))?.code,
    ).toBe('INVALID_STATE');
  });
});
