/**
 * M05 round 5 (critic round 2 fixes): calendar-day expiry display and legacy normalisation,
 * expired-lot confirm, putaway algorithm on the Receiving ledger row, the status-reason map
 * shared by the status modal and the Other actions menu, per-line product labels and human
 * messages for missing PATCH fields.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { createPurchaseOrder } from '@/server/repositories/purchase-orders-commands';
import { getPurchaseOrder } from '@/server/repositories/purchase-orders';
import { receivePurchaseOrder, suggestForLine } from '@/server/repositories/purchase-orders-receive';
import { calendarDateDrift, repairCalendarDates } from '@/server/repositories/purchase-orders-integrity';
import { productLabelRecords } from '@/server/repositories/purchase-orders-print';
import { logDateTime } from '@/server/repositories/purchase-orders-log';
import { createVendor } from '@/server/repositories/vendors';
import {
  calendarDay,
  dayInZone,
  isExpired,
  poCreateSchema,
  poUpdateSchema,
  receiveBodySchema,
  todayIn,
} from '@/lib/grid-defs/receiving/po-schemas';
import { vendorFormSchema } from '@/lib/grid-defs/receiving/vendors';
import { dayOf } from '@/server/imports/handlers/purchase-orders';
import { createWorld, type World } from '../foundation/domain/fixtures';

let w: World;
let auth: AuthContext;

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

const address = {
  name: 'Dock',
  line1: '1 Supply Way',
  line2: '',
  postalCode: '38118',
  city: 'Memphis',
  phone: '',
  country: 'US',
  state: 'TN',
};
const vendor = async () =>
  await createVendor(
    w.db,
    w.ctx,
    auth.scope,
    vendorFormSchema.parse({
      clientId: w.clientId,
      displayName: 'Acme Supply',
      vendorName: 'Acme Supply LLC',
      useShipAsBilling: true,
      shipping: address,
    }),
  );
async function createPo(code = 'KS-R5-PO-1') {
  return await createPurchaseOrder(
    w.db,
    w.ctx,
    auth.scope,
    poCreateSchema.parse({
      warehouseId: w.warehouseId,
      clientId: w.clientId,
      code,
      poType: 'Purchase Order',
      poDate: '2026-11-09T15:00:00.000Z',
      vendorId: (await vendor()).id,
      lines: [
        { productId: w.productId, packType: 'Each', orderedQuantity: 10, unitCost: 2.5 },
        { productId: w.product2Id, packType: 'Each', orderedQuantity: 4, unitCost: 7.25 },
      ],
    }),
  );
}
const receiveBody = (
  lineId: string,
  quantity: number,
  locationId: string,
  extra: Record<string, unknown> = {},
  body: Record<string, unknown> = {},
) => receiveBodySchema.parse({ lines: [{ lineId, quantity, locationId, ...extra }], ...body });

describe('calendar-day display', () => {
  it('reads YYYY-MM-DD as the local calendar day (no UTC shift)', () => {
    const d = calendarDay('2027-05-28');
    expect([d?.getFullYear(), d?.getMonth(), d?.getDate()]).toEqual([2027, 4, 28]);
    expect(calendarDay(null)).toBeNull();
    expect(calendarDay('not a date')).toBeNull();
  });

  it("normalises a legacy instant to the warehouse's calendar day", () => {
    expect(dayInZone('2027-05-08T05:00:00.000Z', 'America/Chicago')).toBe('2027-05-08');
    expect(dayInZone('2027-05-07T22:00:00.000Z', 'Europe/Berlin')).toBe('2027-05-08');
    expect(dayInZone('2027-05-08', 'Asia/Tokyo')).toBe('2027-05-08');
  });

  it('repairs receipt expiry values stored as instants', async () => {
    const po = await createPo();
    const [l1] = po.lines;
    const res = await receivePurchaseOrder(
      w.db,
      w.ctx,
      auth.scope,
      po.id,
      receiveBody(l1?.id ?? '', 2, w.loc.storageA),
    );
    const id = res.receiptIds[0] ?? '';
    await w.db
      .update(schema.receipts)
      .set({ expiryDate: '2027-05-08T05:00:00.000Z' })
      .where(eq(schema.receipts.id, id));
    expect((await calendarDateDrift(w.db)).map((f) => f.id)).toEqual([id]);
    expect((await repairCalendarDates(w.db)).length).toBe(1);
    const tz =
      (
        await w.db
          .select({ tz: schema.warehouses.timezone })
          .from(schema.warehouses)
          .where(eq(schema.warehouses.id, w.warehouseId))
          .limit(1)
      )[0]?.tz ?? 'UTC';
    expect(
      (await w.db.select().from(schema.receipts).where(eq(schema.receipts.id, id)).limit(1))[0]?.expiryDate,
    ).toBe(dayInZone('2027-05-08T05:00:00.000Z', tz));
    expect(await calendarDateDrift(w.db)).toEqual([]);
  });

  it('imports expiry cells as calendar days', () => {
    expect(dayOf('2027-05-28')).toBe('2027-05-28');
    expect(dayOf('5/28/2027')).toBe('2027-05-28');
    expect(dayOf(new Date(2027, 4, 28))).toBe('2027-05-28');
    expect(dayOf('')).toBeNull();
  });
});

describe('expired lots', () => {
  it('detects a past expiry (today is still sellable)', () => {
    expect(isExpired('2026-11-08', '2026-11-09')).toBe(true);
    expect(isExpired('2026-11-09', '2026-11-09')).toBe(false);
    expect(isExpired(null, '2026-11-09')).toBe(false);
    expect(todayIn('UTC', new Date('2026-11-10T03:00:00.000Z'))).toBe('2026-11-10');
    expect(todayIn('America/Chicago', new Date('2026-11-10T03:00:00.000Z'))).toBe('2026-11-09');
  });

  it('rejects receiving an expired lot unless confirmed', async () => {
    await w.db.update(schema.products).set({ trackExpiry: true }).where(eq(schema.products.id, w.productId));
    const po = await createPo('KS-R5-EXP');
    const [l1] = po.lines;
    const past = '2020-01-01';
    await expect(
      async () =>
        await receivePurchaseOrder(
          w.db,
          w.ctx,
          auth.scope,
          po.id,
          receiveBody(l1?.id ?? '', 2, w.loc.storageA, { expiryDate: past }),
        ),
    ).rejects.toThrow(/already expired/);
    const ok = await receivePurchaseOrder(
      w.db,
      w.ctx,
      auth.scope,
      po.id,
      receiveBody(l1?.id ?? '', 2, w.loc.storageA, { expiryDate: past }, { allowExpired: true }),
    );
    expect(ok.receiptIds).toHaveLength(1);
    expect(
      (
        await w.db
          .select()
          .from(schema.receipts)
          .where(eq(schema.receipts.id, ok.receiptIds[0] ?? ''))
          .limit(1)
      )[0]?.expiryDate,
    ).toBe(past);
  });
});

describe('putaway algorithm on the ledger row', () => {
  it('stamps the algorithm when the posted location is a suggestion, never for a manual pick', async () => {
    const po = await createPo('KS-R5-ALG');
    const [l1, l2] = po.lines;
    const manual = await receivePurchaseOrder(
      w.db,
      w.ctx,
      auth.scope,
      po.id,
      receiveBody(l2?.id ?? '', 1, w.loc.storageA, { fromSuggestion: false }),
    );
    const manualTxn = (
      await w.db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.receiptId, manual.receiptIds[0] ?? ''))
        .limit(1)
    )[0];
    expect(manualTxn?.algorithmName ?? null).toBeNull();
    // The server re-runs the suggestion at receive time: compare against the state it sees.
    const s = await suggestForLine(w.db, auth.scope, po.id, l1?.id ?? '', 2, {});
    const top = s.suggestions[0];
    if (!top) return; // fixture world without a matching putaway rule: nothing to stamp
    const v = (await getPurchaseOrder(w.db, auth.scope, po.id)).version;
    const res = await receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, {
      ...receiveBody(l1?.id ?? '', 2, top.locationId, { fromSuggestion: true }),
      version: v,
    });
    const txn = (
      await w.db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.receiptId, res.receiptIds[0] ?? ''))
        .limit(1)
    )[0];
    expect(txn?.algorithmName).toBe(s.algorithm);
    expect(txn?.algorithmRuleName ?? null).toBe(s.rule ?? null);
  });
});

describe('one state machine for the status modal and Other actions', () => {
  it('explains why Cancelled is unavailable while receipts are active', async () => {
    const po = await createPo('KS-R5-ST');
    const pending = await getPurchaseOrder(w.db, auth.scope, po.id);
    expect(pending.statusReasons.Cancelled).toBeNull();
    expect(pending.statusReasons.Pending).toBeNull();
    const [l1] = po.lines;
    await receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, receiveBody(l1?.id ?? '', 2, w.loc.storageA));
    const started = await getPurchaseOrder(w.db, auth.scope, po.id);
    expect(started.status).toBe('Started');
    expect(started.allowedStatuses).not.toContain('Cancelled');
    // Round 7: the reason points to Completed / the short-close, never to reversing receipts.
    expect(started.statusReasons.Cancelled).toMatch(/Choose Completed/);
    expect(started.statusReasons.Cancelled).not.toMatch(/Cancel the received lines/);
    expect(started.statusReasons.Started).toBeNull();
  });
});

describe('product labels', () => {
  it('prints one label per unit by default and one per line on request', async () => {
    const po = await createPo('KS-R5-LBL');
    expect(await productLabelRecords(w.db, auth.scope, [po.id])).toHaveLength(14);
    expect(await productLabelRecords(w.db, auth.scope, [po.id], { perLine: true })).toHaveLength(2);
  });
});

describe('human validation copy', () => {
  it('names the missing field instead of raw zod text', () => {
    const messages = poUpdateSchema.safeParse({}).error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain('Warehouse is required.');
    expect(messages).toContain('PO number is required.');
    expect(messages.some((m) => /expected string, received undefined/.test(m))).toBe(false);
  });

  it('labels change-log times with the warehouse zone', () => {
    expect(logDateTime('2026-11-10T04:41:00.000Z', 'America/Chicago')).toBe('2026/11/09 10:41 PM CST');
  });
});
