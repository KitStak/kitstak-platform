/** M01 Shipment Orders repositories against an in-memory migrated DB: grid list, detail, commands, bulk, labels/print guards, imports, search. */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { AuthContext } from '@/server/auth/context';
import { allocateOrders } from '@/server/domain/allocation';
import { createJobsFromOrders } from '@/server/domain/jobs';
import { ledger } from '@/server/domain/ledger';
import { EMPTY_GRID_QUERY, type GridQuery } from '@/server/query/grid-query';
import {
  findOrderRow,
  getOrderDetail,
  listOrders,
  ordersByIds,
  orderViewCounts,
} from '@/server/repositories/orders';
import { BULK_BODY_SCHEMAS, runOrderBulk } from '@/server/repositories/orders-bulk';
import {
  changeLine,
  codeAvailable,
  createOrder,
  createOrderBodySchema,
  duplicateOrder,
  releaseWorkflowBlock,
  updateOrder,
  updateOrderBodySchema,
} from '@/server/repositories/orders-commands';
import {
  applyShipmentOrderRow,
  applyShipmentOrderUpdateRow,
  importCountry,
} from '@/server/repositories/orders-import';
import { REPRINT_GUARD, runLabelBulk, VOID_GUARD } from '@/server/repositories/orders-labels';
import { buildPrintRecords, PICK_LIST_GUARD } from '@/server/repositories/orders-print';
import { provider as searchProvider } from '@/server/search/providers/orders';
import { createWorld, orderInput, type World } from '../foundation/domain/fixtures';

let w: World;
let scope: { warehouseIds: string[]; clientIds: 'all' };

beforeEach(async () => {
  w = await createWorld();
  scope = { warehouseIds: [w.warehouseId], clientIds: 'all' };
});
afterEach(() => w.close());

const q = (over: Partial<GridQuery> = {}): GridQuery => ({ ...EMPTY_GRID_QUERY, ...over });
const body = (lines: { productId: string; quantity: number }[], extra: Record<string, unknown> = {}) =>
  createOrderBodySchema.parse(orderInput(w, lines, extra));
const mk = async (qty = 2, extra: Record<string, unknown> = {}) =>
  await createOrder(w.db, w.ctx, body([{ productId: w.productId, quantity: qty }], extra));
const stock = async (qty: number, productId = w.productId) =>
  await ledger.add(w.db, w.ctx, {
    warehouseId: w.warehouseId,
    clientId: w.clientId,
    productId,
    locationId: w.loc.storageA,
    qty,
  });
const row = async (id: string) =>
  (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).limit(1))[0];
const logs = async (id: string) =>
  await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, id));
const auth = () =>
  ({
    scope,
    viewScope: scope,
    permissions: new Set<string>(),
    user: { id: w.userId },
  }) as unknown as AuthContext;

describe('createOrder (wizard save)', () => {
  it('creates an Open order with product-master weight, a Create entry and one entry per line', async () => {
    const o = await createOrder(
      w.db,
      w.ctx,
      body(
        [
          { productId: w.productId, quantity: 2 },
          { productId: w.product2Id, quantity: 1 },
        ],
        { code: 'KS-E2E-SO-1', taxType: 'VAT', bol: 'BOL-1' },
      ),
    );
    expect(o).toMatchObject({
      code: 'KS-E2E-SO-1',
      status: 'Open',
      totalQuantity: 3,
      totalWeightOz: 24,
      taxType: 'VAT',
      bol: 'BOL-1',
    });
    expect(o.shipState).toBe('AR');
    const all = await logs(o.id);
    expect(all.find((l) => l.type === 'Create')?.message).toBe('Shipment Order KS-E2E-SO-1 is created.');
    const lineLogs = await w.db
      .select()
      .from(schema.changeLog)
      .where(eq(schema.changeLog.parentEntityId, o.id));
    expect(lineLogs.map((l) => l.message)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^MLT-WIDGET-01 -> /),
        expect.stringMatching(/^MLT-GADGET-02 -> /),
      ]),
    );
    // Exactly one entry per line: the domain writes it; the repository must not duplicate it.
    expect(lineLogs.filter((l) => l.type === 'Create')).toHaveLength(2);
  });

  it('checks code uniqueness case-insensitively and rejects a customer of another client', async () => {
    const o = await mk(1, { code: 'SO-UNIQ' });
    expect(await codeAvailable(w.db, 'so-uniq')).toBe(false);
    expect(await codeAvailable(w.db, 'so-uniq', o.id)).toBe(true);
    expect(await codeAvailable(w.db, 'SO-FREE')).toBe(true);
    const cust = (
      await w.db
        .insert(schema.customers)
        .values({
          clientId: w.otherClientId,
          firstName: 'O',
          lastName: 'T',
          email: 'o@x.io',
          phone: '1',
          name: 'Other',
          code: 'C1',
        } as typeof schema.customers.$inferInsert)
        .returning()
    )[0];
    await expect(async () => await mk(1, { customerId: cust.id })).rejects.toThrow(/Customer not found/);
  });
});

describe('updateOrder (detail edit)', () => {
  it('logs extra fields with readable values and raises CONFLICT on a stale version', async () => {
    const o = await mk();
    const u = await updateOrder(
      w.db,
      w.ctx,
      o.id,
      updateOrderBodySchema.parse({ version: o.version, patch: { note: 'Leave at door', pro: 'PRO-77' } }),
    );
    expect(u.version).toBeGreaterThan(o.version);
    expect((await logs(o.id)).map((l) => l.message)).toEqual(
      expect.arrayContaining([
        'Note is modified. — --> Leave at door',
        expect.stringMatching(/is modified\. — --> PRO-77$/),
      ]),
    );
    await expect(
      async () =>
        await updateOrder(
          w.db,
          w.ctx,
          o.id,
          updateOrderBodySchema.parse({ version: o.version, patch: { note: 'stale' } }),
        ),
    ).rejects.toThrow(/changed since/);
  });

  it('locks warehouse and client and only allows notes/return info on terminal orders', async () => {
    const o = await mk();
    const locked = await updateOrder(
      w.db,
      w.ctx,
      o.id,
      updateOrderBodySchema.parse({ version: o.version, patch: { clientId: w.otherClientId, note: 'n' } }),
    );
    expect(locked.clientId).toBe(w.clientId);
    await runOrderBulk('cancel', w.db, w.ctx, { ids: [o.id], reasonId: 'r1' });
    const c = await row(o.id);
    await expect(
      async () =>
        await updateOrder(
          w.db,
          w.ctx,
          o.id,
          updateOrderBodySchema.parse({ version: c?.version, patch: { bol: 'X' } }),
        ),
    ).rejects.toThrow(/Only notes/);
  });

  it('adds, edits and deletes lines but never removes the last line', async () => {
    const o = await mk(2);
    const a = await changeLine(w.db, w.ctx, o.id, o.version, {
      kind: 'add',
      line: { productId: w.product2Id, quantity: 4 },
    });
    expect(a.totalQuantity).toBe(6);
    const lines = await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id));
    const e = await changeLine(w.db, w.ctx, o.id, a.version, {
      kind: 'edit',
      lineId: lines[0]!.id,
      patch: { quantity: 1 },
    });
    const d = await changeLine(w.db, w.ctx, o.id, e.version, { kind: 'delete', lineId: lines[1]!.id });
    expect(d.totalQuantity).toBe(1);
    await expect(
      async () => await changeLine(w.db, w.ctx, o.id, d.version, { kind: 'delete', lineId: lines[0]!.id }),
    ).rejects.toThrow(/at least one line/);
    await expect(
      async () => await changeLine(w.db, w.ctx, o.id, d.version, { kind: 'edit', lineId: 'nope', patch: {} }),
    ).rejects.toThrow(/not found/);
  });

  it('duplicates an order into a new Open order', async () => {
    const o = await mk(3, { retailerPo: 'PO-9' });
    const copy = await duplicateOrder(w.db, w.ctx, o.id);
    expect(copy.id).not.toBe(o.id);
    expect(copy).toMatchObject({ status: 'Open', totalQuantity: 3, retailerPo: 'PO-9', channel: 'Manual' });
  });

  it('releases a workflow block once', async () => {
    const o = await mk();
    await expect(async () => await releaseWorkflowBlock(w.db, w.ctx, o.id, o.version)).rejects.toThrow(
      /not blocked/,
    );
    await w.db
      .update(schema.shipmentOrders)
      .set({ workflowBlocked: 'Blocked' } as never)
      .where(eq(schema.shipmentOrders.id, o.id));
    const r = await releaseWorkflowBlock(w.db, w.ctx, o.id, o.version);
    expect(r.workflowBlocked).toBe('None');
  });
});

describe('listOrders (grid grammar)', () => {
  it("returns correlated columns per order (SKU list, tags, allocated) — not the subquery's own id", async () => {
    const a = await createOrder(
      w.db,
      w.ctx,
      body([
        { productId: w.productId, quantity: 1 },
        { productId: w.product2Id, quantity: 2 },
      ]),
    );
    const b = await mk(5);
    const res = await listOrders(w.db, scope, {
      view: 'backlog',
      query: q({ sort: [{ field: 'code', dir: 'asc' }] } as never),
    });
    expect(res.total).toBe(2);
    const byId = new Map(res.rows.map((r) => [r.id, r as unknown as Record<string, unknown>]));
    expect(String(byId.get(a.id)?.skus).split(' / ').sort()).toEqual(['MLT-GADGET-02', 'MLT-WIDGET-01']);
    expect(byId.get(b.id)?.skus).toBe('MLT-WIDGET-01');
    expect(byId.get(b.id)?.hasActiveTask).toBe(false);
    expect(byId.get(a.id)?.tags).toEqual([]);
  });

  it('splits backlog vs shipped & canceled, filters by status and quick search, and respects scope', async () => {
    const a = await mk(1, { code: 'KS-A' });
    await mk(1, { code: 'KS-B' });
    await runOrderBulk('cancel', w.db, w.ctx, { ids: [a.id], reasonId: 'r1' });
    expect((await listOrders(w.db, scope, { view: 'backlog', query: q() })).total).toBe(1);
    const shipped = await listOrders(w.db, scope, { view: 'shipped', query: q() });
    expect(shipped.rows.map((r) => r.code)).toEqual(['KS-A']);
    expect(
      (await listOrders(w.db, scope, { view: 'backlog', query: q({ q: 'KS-B', qm: 'eq' }) })).total,
    ).toBe(1);
    expect((await listOrders(w.db, scope, { view: 'backlog', query: q({ q: 'KS', qm: 'sw' }) })).total).toBe(
      1,
    );
    expect(
      (await listOrders(w.db, { warehouseIds: [], clientIds: 'all' }, { view: 'backlog', query: q() })).total,
    ).toBe(0);
    expect(await orderViewCounts(w.db, scope)).toEqual({ backlog: 1, shipped: 1 });
    expect((await ordersByIds(w.db, scope, [a.id])).map((r) => r.code)).toEqual(['KS-A']);
  });

  it('finds by id or code and builds detail action reasons', async () => {
    const o = await mk();
    expect((await findOrderRow(w.db, scope, o.code))?.id).toBe(o.id);
    const d = await getOrderDetail(w.db, { scope }, o.id);
    expect(d?.jobs).toEqual([]);
    expect(d?.actions.delete).toBeNull();
    expect(d?.actions.release).toBe('Only orders on hold can be released.');
    expect(await getOrderDetail(w.db, { scope: { warehouseIds: [], clientIds: 'all' } }, o.id)).toBeNull();
  });
});

describe('allocate, job and cancel', () => {
  it('job shows its code on the detail; Delete/Cancel blocked with reasons; cancel releases allocations', async () => {
    await stock(10);
    const o = await mk(3);
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    await createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId } as never);
    const d = await getOrderDetail(w.db, { scope }, o.id);
    expect(d?.order.status).toBe('Ready to Pick');
    expect(d?.jobs[0]?.code).toMatch(/^Job/);
    expect(d?.jobs[0]?.code).not.toBe(d?.jobs[0]?.id);
    expect(d?.actions.delete).toMatch(/Only Open orders/);
    expect(d?.actions.cancel).toMatch(/in a job/);
    const cw = await runOrderBulk('change-warehouse', w.db, w.ctx, {
      ids: [o.id],
      warehouseId: (
        await w.db
          .insert(schema.warehouses)
          .values({
            code: 'KS2',
            name: 'Two',
            addressLine: '1',
            city: 'c',
            state: 'TN',
            postalCode: '1',
            timezone: 'America/Chicago',
          } as never)
          .returning()
      )[0].id,
    });
    expect(cw.failed).toHaveLength(1);
    expect(cw.succeeded).toHaveLength(0);
  });

  it('cancel needs a reason (schema) and restores ATP', async () => {
    await stock(5);
    const o = await mk(2);
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    expect(BULK_BODY_SCHEMAS.cancel.safeParse({ ids: [o.id], reasonId: '' }).success).toBe(false);
    const res = await runOrderBulk('cancel', w.db, w.ctx, { ids: [o.id], reasonId: 'r1' });
    expect(res.succeeded).toEqual([o.id]);
    expect((await row(o.id))?.status).toBe('Cancelled');
    const alloc = (
      await w.db.select().from(schema.inventory).where(eq(schema.inventory.productId, w.productId))
    ).reduce((s, r) => s + r.allocated, 0);
    expect(alloc).toBe(0);
  });

  it('logs the cancel reason by name, never by its lookup id', async () => {
    const reason = (
      await w.db
        .insert(schema.lookupValues)
        .values({
          type: 'so_cancel_reason',
          name: 'Customer request',
        } as typeof schema.lookupValues.$inferInsert)
        .returning()
    )[0];
    const o = await mk(1);
    expect(
      (await runOrderBulk('cancel', w.db, w.ctx, { ids: [o.id], reasonId: reason.id })).succeeded,
    ).toEqual([o.id]);
    const entry = (await logs(o.id)).find((l) => l.field === 'cancelReasonId');
    expect(entry?.toValue).toBe('Customer request');
    expect(entry?.message).not.toContain(reason.id);
  });

  it('back-orders the short quantity into a child with masterOrderId', async () => {
    await stock(2);
    const o = await mk(5);
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId, mode: 'partial' });
    expect((await row(o.id))?.status).toBe('Shortage');
    const res = await runOrderBulk('backorder', w.db, w.ctx, { ids: [o.id] });
    expect(res.childIds).toHaveLength(1);
    const child = await row(res.childIds![0]!);
    expect(child?.masterOrderId).toBe(o.id);
    expect(child?.totalQuantity).toBe(3);
  });

  it('hold / release / delete / short and serial guards report per-id results', async () => {
    const o = await mk();
    expect((await runOrderBulk('hold', w.db, w.ctx, { ids: [o.id] })).succeeded).toEqual([o.id]);
    expect((await row(o.id))?.status).toBe('On Hold');
    expect((await runOrderBulk('release', w.db, w.ctx, { ids: [o.id] })).succeeded).toEqual([o.id]);
    expect(
      (await runOrderBulk('resolve-pick-short', w.db, w.ctx, { ids: [o.id] })).failed[0]?.message,
    ).toMatch(/no open pick short/);
    expect((await runOrderBulk('cancel-picking', w.db, w.ctx, { ids: [o.id] })).failed[0]?.message).toMatch(
      /active picking\/packing tasks/,
    );
    expect((await runOrderBulk('remove-serials', w.db, w.ctx, { ids: [o.id] })).failed[0]?.message).toMatch(
      /no serial numbers/,
    );
    expect(
      (await runOrderBulk('update-return-info', w.db, w.ctx, { ids: [o.id], returnShippingCost: 3 }))
        .failed[0]?.message,
    ).toMatch(/shipped orders/);
    expect((await runOrderBulk('delete', w.db, w.ctx, { ids: [o.id] })).succeeded).toEqual([o.id]);
    expect((await row(o.id))?.deletedAt).toBeTruthy();
    expect((await listOrders(w.db, scope, { view: 'backlog', query: q() })).total).toBe(0);
  });
});

describe('label and print guards', () => {
  it("uses Logiwa's exact guard copy for reprint/void without a label and for the picking list", async () => {
    const o = await mk();
    const reprint = await runLabelBulk(w.db, w.ctx, { action: 'reprint', ids: [o.id] });
    expect(reprint.failed[0]?.message).toBe(REPRINT_GUARD);
    const voided = await runLabelBulk(w.db, w.ctx, { action: 'void', ids: [o.id] });
    expect(voided.failed[0]?.message).toBe(VOID_GUARD);
    const pick = await buildPrintRecords(w.db, scope, { type: 'picking-list', ids: [o.id] } as never);
    expect(pick.ineligible[0]?.reason).toBe(PICK_LIST_GUARD);
    const slip = await buildPrintRecords(w.db, scope, { type: 'packing-slip', ids: [o.id] } as never);
    expect(slip.records).toHaveLength(1);
  });
});

describe('imports', () => {
  const ctxFor = (batchId: string, rowNumber = 1) => ({
    db: w.db,
    auth: auth(),
    actor: { userId: w.userId, source: 'import' },
    batchId,
    rowNumber,
  });
  const base = {
    clientCode: 'ACME',
    warehouseCode: 'MLT1',
    shipToName: 'Ann',
    shipToAddress1: '1 Main',
    shipToCity: 'Memphis',
    shipToPostalCode: '38118',
    shipToState: 'TN',
    shipToCountry: 'US',
  };

  it('groups rows by order code into one order with lines; bad rows fail alone', async () => {
    await applyShipmentOrderRow(ctxFor('b1', 1), {
      ...base,
      orderCode: 'IMP-1',
      sku: 'MLT-WIDGET-01',
      quantity: 2,
    });
    await applyShipmentOrderRow(ctxFor('b1', 2), {
      ...base,
      orderCode: 'IMP-1',
      sku: 'MLT-GADGET-02',
      quantity: 1,
    });
    await expect(
      async () =>
        await applyShipmentOrderRow(ctxFor('b1', 3), {
          ...base,
          orderCode: 'IMP-2',
          sku: 'NOPE',
          quantity: 1,
        }),
    ).rejects.toThrow(/not found/);
    await expect(
      async () =>
        await applyShipmentOrderRow(ctxFor('b1', 4), { ...base, orderCode: 'IMP-3', sku: 'MLT-WIDGET-01' }),
    ).rejects.toThrow(/required/);
    const o = (
      await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.code, 'IMP-1')).limit(1)
    )[0];
    expect(o?.totalQuantity).toBe(3);
    expect(o?.shipCountry).toBe(importCountry('US'));
    await expect(
      async () =>
        await applyShipmentOrderRow(ctxFor('b2'), {
          ...base,
          orderCode: 'IMP-1',
          sku: 'MLT-WIDGET-01',
          quantity: 1,
        }),
    ).rejects.toThrow(/already exists/);
  });

  it('bulk update changes only filled columns', async () => {
    await mk(1, { code: 'UPD-1' });
    await applyShipmentOrderUpdateRow(ctxFor('u1'), {
      orderCode: 'UPD-1',
      shipToCity: 'Nashville',
      priority: 'high',
    });
    const o = (
      await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.code, 'UPD-1')).limit(1)
    )[0];
    expect(o).toMatchObject({ shipCity: 'Nashville', priority: 'High', customerName: 'Jane Doe' });
    await expect(
      async () => await applyShipmentOrderUpdateRow(ctxFor('u1'), { orderCode: 'UPD-1' }),
    ).rejects.toThrow(/no columns/);
  });
});

describe('global search', () => {
  it('finds an order by tracking number on its shipment label, store order # and customer', async () => {
    const o = await mk(1, { storeOrderNumber: 'SHP-123' });
    const other = await mk(1);
    await w.db.insert(schema.shipments).values({
      orderId: other.id,
      clientId: w.clientId,
      warehouseId: w.warehouseId,
      carrierConnectionId: w.carrierConnectionId,
      carrierServiceId: w.serviceIds.ground,
      trackingNumber: '1ZTRACK999',
      weight: 8,
      length: 4,
      width: 4,
      height: 2,
      carrierCode: 'UPS',
      serviceName: 'Ground',
      labelType: 'Shipping Label',
      labelStatus: 'Active',
    } as never);
    const ctx = (term: string) => ({ db: w.db, auth: auth(), q: term, limit: 10 }) as never;
    const ids = async (term: string) =>
      (await searchProvider.search(ctx(term))).map((h: { id: string }) => h.id);
    expect(await ids('1ZTRACK999')).toEqual([other.id]);
    expect(await ids('SHP-123')).toEqual([o.id]);
    expect(await searchProvider.count?.(ctx('Jane'))).toBe(2);
    expect(and).toBeDefined();
  });
});
