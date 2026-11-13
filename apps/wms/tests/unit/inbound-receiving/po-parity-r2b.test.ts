/**
 * M05 round 2 (critic round 1 fixes): Receive PO gating for tracked lines, Actual Receiving
 * Date stamped on completion only, change-log humanising, receipt cancel log, receiver
 * display name, date-only attributes, status drift repair, blur validation, rail ring.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { ledger } from '@/server/domain/ledger';
import {
  getPurchaseOrder,
  listPurchaseOrders,
  RECEIVE_ALL_TRACKED_REASON,
} from '@/server/repositories/purchase-orders';
import { createPurchaseOrder, updatePurchaseOrder } from '@/server/repositories/purchase-orders-commands';
import { poStatusDrift, repairPoStatusDrift } from '@/server/repositories/purchase-orders-integrity';
import {
  EMPTY_LOG_VALUE,
  logDate,
  logDateTime,
  logSnapshot,
} from '@/server/repositories/purchase-orders-log';
import { dateOnly, receiveAll, receivePurchaseOrder } from '@/server/repositories/purchase-orders-receive';
import { cancelReceipt, receiptsForPurchaseOrder } from '@/server/repositories/receipts';
import { createVendor } from '@/server/repositories/vendors';
import { EMPTY_GRID_QUERY } from '@/server/query/grid-query';
import { poCreateSchema, receiveBodySchema } from '@/lib/grid-defs/receiving/po-schemas';
import { vendorFormSchema } from '@/lib/grid-defs/receiving/vendors';
import { receiveAllReason } from '@/components/receiving/po-list-page';
import { receivedSummaryTone } from '@/components/receiving/po-detail-page';
import {
  confirmStepSchema,
  detailsStepSchema,
  emptyValues,
  humanReasons,
} from '@/components/receiving/wizard/po-form-model';
import { toDay } from '@/lib/grid-defs/receiving/po-schemas';
import { issuesByField } from '@/components/receiving/wizard/use-blur-validation';
import type { PoRow } from '@/components/receiving/receiving-shared';
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
async function createPo(code = 'KS-R2-PO-1') {
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
) => receiveBodySchema.parse({ lines: [{ lineId, quantity, locationId, ...extra }] });
const poLog = async (id: string) =>
  await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, id));

describe('Receive PO gating for tracked lines', () => {
  it('flags a lot-tracked open line on list and detail rows, and receiveAll refuses with the same reason', async () => {
    await w.db.update(schema.products).set({ trackLot: true }).where(eq(schema.products.id, w.productId));
    const po = await createPo();
    const detail = await getPurchaseOrder(w.db, auth.scope, po.id);
    expect(detail.receiveAllBlockedReason).toMatch(new RegExp(`^${RECEIVE_ALL_TRACKED_REASON}`));
    const row = (await listPurchaseOrders(w.db, auth, { ...EMPTY_GRID_QUERY, q: po.code, qm: 'eq' })).rows[0];
    expect(row?.receiveAllBlockedReason).toBe(detail.receiveAllBlockedReason);
    await expect(async () => await receiveAll(w.db, w.ctx, auth.scope, po.id)).rejects.toThrow(
      RECEIVE_ALL_TRACKED_REASON,
    );
  });
  it('is clear for untracked lines and once the tracked line is received', async () => {
    const plain = await createPo('KS-R2-PLAIN');
    expect((await getPurchaseOrder(w.db, auth.scope, plain.id)).receiveAllBlockedReason).toBeNull();
    await w.db.update(schema.products).set({ trackLot: true }).where(eq(schema.products.id, w.productId));
    const line = (await getPurchaseOrder(w.db, auth.scope, plain.id)).lines.find(
      (l) => l.productId === w.productId,
    );
    await receivePurchaseOrder(
      w.db,
      w.ctx,
      auth.scope,
      plain.id,
      receiveBody(line?.id ?? '', 10, w.loc.storageA, { lotNumber: 'L123' }),
    );
    expect((await getPurchaseOrder(w.db, auth.scope, plain.id)).receiveAllBlockedReason).toBeNull();
  });
  it('client gate: status first, then fully received, then tracked lines', () => {
    const base = {
      code: 'PO1',
      status: 'Started',
      totalQuantity: 10,
      receivedQuantity: 0,
      receiveAllBlockedReason: null,
    } as unknown as PoRow;
    expect(receiveAllReason([{ ...base, status: 'Completed' }])).toMatch(/Only Pending or Started/);
    expect(receiveAllReason([{ ...base, receivedQuantity: 10 }])).toBe('PO1 is fully received.');
    expect(receiveAllReason([{ ...base, receiveAllBlockedReason: 'X (SKU).' }])).toBe('X (SKU).');
    expect(receiveAllReason([base, { ...base, code: 'PO2', receiveAllBlockedReason: 'X (SKU).' }])).toBe(
      'PO2: X (SKU).',
    );
    expect(receiveAllReason([base])).toBeNull();
  });
});

describe('Actual Receiving Date', () => {
  it('is not stamped on a partial receipt, is stamped on completion, and a cancelled-only receipt leaves it empty', async () => {
    const po = await createPo();
    const [l1, l2] = po.lines;
    await receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, receiveBody(l1?.id ?? '', 6, w.loc.storageA));
    const started = await getPurchaseOrder(w.db, auth.scope, po.id);
    expect(started.status).toBe('Started');
    expect(started.receivedAt).toBeNull();
    const [receipt] = await receiptsForPurchaseOrder(w.db, auth.scope, po.id);
    await cancelReceipt(w.db, w.ctx, auth.scope, receipt?.id ?? '');
    expect((await getPurchaseOrder(w.db, auth.scope, po.id)).receivedAt).toBeNull();
    await receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, {
      lines: [
        ...receiveBody(l1?.id ?? '', 10, w.loc.storageA).lines,
        ...receiveBody(l2?.id ?? '', 4, w.loc.storageA).lines,
      ],
      allowOverReceipt: false,
      allowExpired: false,
    });
    const done = await getPurchaseOrder(w.db, auth.scope, po.id);
    expect(done.status).toBe('Completed');
    expect(done.receivedAt).not.toBeNull();
    expect(done.receivedAt).toBe(done.completedAt);
  });
});

describe('change log', () => {
  it("logs line creation as 'Purchase Order Line is created.' and never a blank from-value", async () => {
    const po = await createPo();
    const lines = await w.db
      .select()
      .from(schema.changeLog)
      .where(eq(schema.changeLog.parentEntityId, po.id));
    expect(lines.map((l) => l.message)).toEqual(
      expect.arrayContaining(['MLT-WIDGET-01 -> Purchase Order Line is created.']),
    );
    expect(lines.some((l) => /is modified\.\s+(?:-->|→)/.test(l.message))).toBe(false);
  });
  it('formats header dates for humans and writes (empty) for nulls', async () => {
    const po = await createPo();
    const body = {
      ...poCreateSchema.parse({
        warehouseId: w.warehouseId,
        clientId: w.clientId,
        code: po.code,
        poType: po.poType,
        poDate: po.poDate,
        vendorId: po.vendorId,
        plannedArrivalDate: '2026-11-20T00:00:00.000Z',
        lines: po.lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          packType: l.packType,
          orderedQuantity: l.orderedQuantity,
          unitCost: l.unitCost,
        })),
      }),
      version: po.version,
    };
    await updatePurchaseOrder(w.db, w.ctx, auth.scope, po.id, body);
    const msg = (await poLog(po.id)).find((l) => l.field === 'plannedArrivalDate')?.message;
    expect(msg).toBe(`Planned Arrival Date is modified. ${EMPTY_LOG_VALUE} → 2026/11/20`);
  });
  it('writes an explicit receipt-cancel entry naming the master id, quantity and location', async () => {
    const po = await createPo();
    await receivePurchaseOrder(
      w.db,
      w.ctx,
      auth.scope,
      po.id,
      receiveBody(po.lines[0]?.id ?? '', 6, w.loc.storageA),
    );
    const [receipt] = await receiptsForPurchaseOrder(w.db, auth.scope, po.id);
    await cancelReceipt(w.db, w.ctx, auth.scope, receipt?.id ?? '');
    const entry = (await poLog(po.id)).find((l) => l.field === 'receipt');
    expect(entry?.message).toMatch(
      new RegExp(
        `^Receipt ${receipt?.masterId} is cancelled\\. 6 Each of MLT-WIDGET-01 reversed from \\S+\\.$`,
      ),
    );
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });
  it('log helpers', () => {
    expect(logDate('2026-11-09')).toBe('2026/11/09');
    expect(logDateTime('2026-11-10T03:27:13.549Z', 'UTC')).toBe('Nov 10, 2026, 3:27 AM UTC');
    expect(logDateTime('2026-11-10T03:27:13.549Z', 'America/Chicago')).toBe('Nov 9, 2026, 9:27 PM CST');
    expect(logDateTime('2026-11-10T03:27:13.549Z', 'Not/AZone')).toBe('Nov 10, 2026, 3:27 AM UTC');
    expect(logSnapshot({ receivedAt: null, note: '', status: 'Started' })).toEqual({
      receivedAt: EMPTY_LOG_VALUE,
      note: EMPTY_LOG_VALUE,
      status: 'Started',
    });
  });
});

describe('receipts', () => {
  it("shows the receiver's display name and stores expiry as YYYY-MM-DD", async () => {
    await w.db.update(schema.products).set({ trackExpiry: true }).where(eq(schema.products.id, w.productId));
    const po = await createPo();
    const line = po.lines.find((l) => l.productId === w.productId);
    await receivePurchaseOrder(
      w.db,
      w.ctx,
      auth.scope,
      po.id,
      receiveBody(line?.id ?? '', 2, w.loc.storageA, { expiryDate: '2027-05-08T05:00:00.000Z' }),
    );
    const [r] = await receiptsForPurchaseOrder(w.db, auth.scope, po.id);
    expect(r?.expiryDate).toBe('2027-05-08');
    const user = (await w.db.select().from(schema.users).where(eq(schema.users.id, w.userId)).limit(1))[0];
    expect(r?.receivedBy).toBe(user?.name);
    expect(dateOnly('2027-06-02')).toBe('2027-06-02');
    expect(dateOnly(null)).toBeNull();
  });
});

describe('status drift repair', () => {
  it('settles a fully received PO left in the transient Receiving status as Completed', async () => {
    const po = await createPo();
    await receiveAll(w.db, w.ctx, auth.scope, po.id);
    await w.db
      .update(schema.purchaseOrders)
      .set({ status: 'Receiving', completedAt: null })
      .where(eq(schema.purchaseOrders.id, po.id));
    expect((await poStatusDrift(w.db)).map((d) => [d.code, d.expected])).toEqual([[po.code, 'Completed']]);
    expect(await repairPoStatusDrift(w.db, w.ctx)).toEqual([po.code]);
    const fixed = (
      await w.db
        .select()
        .from(schema.purchaseOrders)
        .where(and(eq(schema.purchaseOrders.id, po.id)))
        .limit(1)
    )[0];
    expect(fixed?.status).toBe('Completed');
    expect(fixed?.completedAt).not.toBeNull();
    expect(await poStatusDrift(w.db)).toEqual([]);
  });
});

describe('putaway reasons and date-only attributes', () => {
  it('turns rule action labels into human reasons, positive matches first', () => {
    expect(
      humanReasons([
        'Check Damaged Locations',
        'Check Location Capacity',
        'Suggest a location that has the same SKU',
      ]),
    ).toEqual(['Already holds this SKU', 'Not a damaged-stock location', 'Has room for this quantity']);
    expect(humanReasons(['Check Damaged Locations'], { damaged: true })).toEqual(['Damaged-stock location']);
    expect(humanReasons(['Suggest a location with the selected area type'])).toEqual([
      "Matches the rule's area type",
    ]);
    expect(humanReasons(['Applied to all', 'Applied to all'])).toEqual(['Matches the putaway rule']);
  });
  it('stores calendar days as YYYY-MM-DD', () => {
    expect(toDay('2027-05-08')).toBe('2027-05-08');
    expect(toDay('2027-05-08T05:00:00.000Z')).toBe('2027-05-08');
  });
});

describe('wizard UX model', () => {
  it("blur validation reports '<Label> is required.' per field", () => {
    const issues = issuesByField(detailsStepSchema, { ...emptyValues(), poDate: '' });
    expect(issues).toMatchObject({
      warehouseId: 'Warehouse is required.',
      clientId: 'Client is required.',
      code: 'PO number is required.',
      poDate: 'PO date is required.',
    });
  });
  it('Confirm counts toward the ring only once shown', () => {
    expect(confirmStepSchema.safeParse(emptyValues()).success).toBe(false);
    expect(confirmStepSchema.safeParse({ ...emptyValues(), reviewed: true }).success).toBe(true);
  });
  it('summary stays neutral until the order closes', () => {
    expect(receivedSummaryTone({ status: 'Pending', receivedQuantity: 0, totalQuantity: 30 })).toBe('open');
    expect(receivedSummaryTone({ status: 'Started', receivedQuantity: 6, totalQuantity: 30 })).toBe('open');
    expect(receivedSummaryTone({ status: 'Completed', receivedQuantity: 30, totalQuantity: 30 })).toBe(
      'exact',
    );
    expect(receivedSummaryTone({ status: 'Cancelled', receivedQuantity: 6, totalQuantity: 30 })).toBe(
      'cancelled',
    );
    expect(receivedSummaryTone({ status: 'Completed', receivedQuantity: 25, totalQuantity: 30 })).toBe(
      'variance',
    );
  });
});
