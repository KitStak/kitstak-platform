/** M04 Returns: Create RMA (cap, label), Return Station receive (Restock / Damaged), Manual RMA, Change Status guards. */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/server/db/schema';
import type { Scope } from '@/server/auth/scope';
import { allocateOrders } from '@/server/domain/allocation';
import { createJobsFromOrders } from '@/server/domain/jobs';
import { ledger } from '@/server/domain/ledger';
import { createOrder } from '@/server/domain/orders';
import { shipOrders } from '@/server/domain/shipping';
import { execute } from '@/server/domain/tasks';
import { EMPTY_GRID_QUERY } from '@/server/query/grid-query';
import {
  bulkUpdateReturnInfo,
  changeReturnStatus,
  createRma,
  getReturnDetail,
  selectionTransitions,
  shippableOrder,
  transitionOptions,
} from '@/server/repositories/returns';
import { listReturnLines, returnStatusCounts } from '@/server/repositories/returns-grid';
import {
  lookupRmas,
  receiveManual,
  receiveManualSchema,
  receiveRma,
  receiveRmaSchema,
  returnStations,
} from '@/server/repositories/returns-receive';
import { createWorld, orderInput, type World } from '../foundation/domain/fixtures';
import { withWriteTx } from '@/server/db/sql';

let w: World;
let scope: Scope;
const previousFilesDir = process.env.KITSTAK_FILES_DIR;

beforeEach(async () => {
  w = await createWorld();
  process.env.KITSTAK_FILES_DIR = w.filesRoot;
  scope = { warehouseIds: [w.warehouseId], clientIds: 'all' } as unknown as Scope;
});
afterEach(async () => {
  await w.close();
  process.env.KITSTAK_FILES_DIR = previousFilesDir;
});

const ctx = () => ({ ...w.ctx, scope });
const pkg = { weightOz: 20, length: 10, width: 8, height: 4 };
const rma = async (id: string) =>
  (await w.db.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, id)).limit(1))[0];
const onHandAt = async (locationId: string) =>
  (await w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, locationId))).reduce(
    (s, r) => s + r.onHand,
    0,
  );

/** An order of `qty` units taken all the way to Shipped. */
async function shippedOrder(qty = 2): Promise<{ orderId: string; lineId: string }> {
  await ledger.add(w.db, w.ctx, {
    warehouseId: w.warehouseId,
    clientId: w.clientId,
    productId: w.productId,
    locationId: w.loc.storageA,
    qty: qty + 3,
  });
  const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }]));
  await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
  const {
    jobIds: [jobId],
  } = await createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
  const tasks = await w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId));
  await execute(w.db, w.ctx, {
    taskIds: tasks.filter((t) => t.taskType === 'Picking').map((t) => t.id),
    targetLocationId: w.loc.pick,
  });
  await execute(w.db, w.ctx, {
    taskIds: tasks.filter((t) => t.taskType === 'Packing').map((t) => t.id),
    targetLocationId: w.loc.pack,
  });
  const shipped = await shipOrders(w.db, w.ctx, { orderIds: [o.id], requireLabel: false });
  expect(shipped.failed).toEqual([]);
  const lineId = (
    await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).limit(1)
  )[0]?.id as string;
  return { orderId: o.id, lineId };
}

async function newRma(orderId: string, lineId: string, quantity = 1, withLabel = false) {
  return createRma(w.db, ctx(), {
    shipmentOrderId: orderId,
    lines: [{ orderLineId: lineId, quantity }],
    expectedReturnDate: '2026-11-20',
    label: withLabel
      ? { carrierConnectionId: w.carrierConnectionId, carrierServiceId: w.serviceIds.ground, package: pkg }
      : null,
  });
}

describe('transition guards', () => {
  it('only offers legal moves', () => {
    const ok = (s: Parameters<typeof transitionOptions>[0], received: number) =>
      transitionOptions(s, received)
        .filter((o) => o.ok)
        .map((o) => o.status);
    expect(ok('Pending', 0)).toEqual(['Started', 'In Transit', 'Cancelled']);
    expect(ok('Pending', 0)).not.toContain('Completed');
    expect(ok('Completed', 1)).toEqual([]);
    expect(ok('Cancelled', 0)).toEqual([]);
    expect(ok('Started', 1)).toContain('Completed');
    expect(ok('Started', 1)).not.toContain('Cancelled');
  });
});

describe('create RMA', () => {
  it('caps quantity at shipped minus already returned and buys a return label', async () => {
    const { orderId, lineId } = await shippedOrder(2);
    const shippable = await shippableOrder(w.db, scope, orderId);
    expect(shippable.lines[0]?.returnable).toBe(2);
    await expect(newRma(orderId, lineId, 3)).rejects.toThrow(/Max 2/);
    const created = await newRma(orderId, lineId, 1, true);
    expect(created.status).toBe('Pending');
    expect(created.labelError).toBeNull();
    expect(created.trackingNumber).toBeTruthy();
    expect((await shippableOrder(w.db, scope, orderId)).lines[0]?.returnable).toBe(1);
    const rows = (await listReturnLines(w.db, scope, EMPTY_GRID_QUERY)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('Pending');
    expect((await returnStatusCounts(w.db, scope)).Pending).toBe(1);
    expect((await getReturnDetail(w.db, scope, created.id)).rmaCode).toBe(created.rmaCode);
  });

  it('refuses an order that has not shipped', async () => {
    await ledger.add(w.db, w.ctx, {
      warehouseId: w.warehouseId,
      clientId: w.clientId,
      productId: w.productId,
      locationId: w.loc.storageA,
      qty: 3,
    });
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const lineId = (
      await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).limit(1)
    )[0]?.id as string;
    await expect(newRma(o.id, lineId)).rejects.toThrow();
  });
});

describe('return station', () => {
  it('receives 1 unit as Restock into the target: receipt, ledger Return Receiving, Completed', async () => {
    const { orderId, lineId } = await shippedOrder(2);
    const created = await newRma(orderId, lineId, 1);
    expect((await returnStations(w.db, scope, w.warehouseId)).map((s) => s.code)).toContain('RET-01');
    expect((await lookupRmas(w.db, scope, w.warehouseId, created.rmaCode))[0]?.receivable).toBe(true);
    const line = (
      await w.db
        .select()
        .from(schema.returnOrderLines)
        .where(eq(schema.returnOrderLines.returnOrderId, created.id))
        .limit(1)
    )[0];
    const before = await onHandAt(w.loc.storageB);
    const res = await withWriteTx(
      w.db,
      async (tx) =>
        await receiveRma(
          tx,
          ctx(),
          receiveRmaSchema.parse({
            returnOrderId: created.id,
            stationLocationId: w.loc.returns,
            targetLocationId: w.loc.storageB,
            items: [
              { returnOrderLineId: line?.id, productId: w.productId, quantity: 1, disposition: 'Restock' },
            ],
          }),
        ),
    );
    expect(res.status).toBe('Completed');
    expect(await onHandAt(w.loc.storageB)).toBe(before + 1);
    const receipts = await w.db
      .select()
      .from(schema.receipts)
      .where(eq(schema.receipts.returnOrderId, created.id));
    expect(receipts.map((r) => r.type)).toEqual(['Return']);
    const txns = await w.db
      .select()
      .from(schema.inventoryTransactions)
      .where(eq(schema.inventoryTransactions.returnOrderId, created.id));
    expect(txns.map((t) => t.type)).toContain('Return Receiving');
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
    // fully received: nothing left
    await expect(
      async () =>
        await withWriteTx(
          w.db,
          async (tx) =>
            await receiveRma(
              tx,
              ctx(),
              receiveRmaSchema.parse({
                returnOrderId: created.id,
                stationLocationId: w.loc.returns,
                targetLocationId: w.loc.storageB,
                items: [{ productId: w.productId, quantity: 1, disposition: 'Restock' }],
              }),
            ),
        ),
    ).rejects.toThrow();
  });

  it('requires a damage reason for Damaged and refuses a Cancelled RMA', async () => {
    const { orderId, lineId } = await shippedOrder(2);
    const created = await newRma(orderId, lineId, 1);
    const body = {
      returnOrderId: created.id,
      stationLocationId: w.loc.returns,
      targetLocationId: w.loc.storageB,
    };
    await expect(
      async () =>
        await withWriteTx(
          w.db,
          async (tx) =>
            await receiveRma(
              tx,
              ctx(),
              receiveRmaSchema.parse({
                ...body,
                items: [{ productId: w.productId, quantity: 1, disposition: 'Damaged' }],
              }),
            ),
        ),
    ).rejects.toThrow(/damage reason/);
    const cancel = await withWriteTx(
      w.db,
      async (tx) => await changeReturnStatus(tx, ctx(), { ids: [created.id], status: 'Cancelled' }),
    );
    expect(cancel.succeeded).toEqual([created.id]);
    expect((await rma(created.id))?.status).toBe('Cancelled');
    await expect(
      async () =>
        await withWriteTx(
          w.db,
          async (tx) =>
            await receiveRma(
              tx,
              ctx(),
              receiveRmaSchema.parse({
                ...body,
                items: [{ productId: w.productId, quantity: 1, disposition: 'Restock' }],
              }),
            ),
        ),
    ).rejects.toThrow(/cancelled and can't be received/);
    const illegal = await withWriteTx(
      w.db,
      async (tx) => await changeReturnStatus(tx, ctx(), { ids: [created.id], status: 'Pending' }),
    );
    expect(illegal.failed[0]?.code).toBe('INVALID_STATE');
    expect((await selectionTransitions(w.db, scope, [created.id])).options.every((o) => !o.ok)).toBe(true);
  });

  it('Return Manually creates a Manual RMA and posts the receipt', async () => {
    const res = await withWriteTx(
      w.db,
      async (tx) =>
        await receiveManual(
          tx,
          ctx(),
          receiveManualSchema.parse({
            warehouseId: w.warehouseId,
            clientId: w.clientId,
            stationLocationId: w.loc.returns,
            targetLocationId: w.loc.storageB,
            customerName: 'Walk-in',
            items: [{ productId: w.productId, quantity: 2, disposition: 'Restock' }],
          }),
        ),
    );
    expect(res.status).toBe('Completed');
    expect((await rma(res.returnOrderId))?.source).toBe('Manual');
    expect(await onHandAt(w.loc.storageB)).toBe(2);
    await expect(
      async () =>
        await withWriteTx(
          w.db,
          async (tx) =>
            await receiveManual(
              tx,
              ctx(),
              receiveManualSchema.parse({
                warehouseId: w.warehouseId,
                clientId: w.otherClientId,
                stationLocationId: w.loc.returns,
                targetLocationId: w.loc.storageB,
                items: [{ productId: w.productId, quantity: 1, disposition: 'Restock' }],
              }),
            ),
        ),
    ).rejects.toThrow(/another client/);
  });

  it('status pill counts agree with the grid total (one row per RMA line)', async () => {
    await withWriteTx(
      w.db,
      async (tx) =>
        await receiveManual(
          tx,
          ctx(),
          receiveManualSchema.parse({
            warehouseId: w.warehouseId,
            clientId: w.clientId,
            stationLocationId: w.loc.returns,
            items: [
              { productId: w.productId, quantity: 1, disposition: 'Restock' },
              { productId: w.productId, quantity: 1, disposition: 'Quarantine' },
            ],
          }),
        ),
    );
    const total = (await listReturnLines(w.db, scope, EMPTY_GRID_QUERY)).total;
    expect(total).toBe(2);
    expect(Object.values(await returnStatusCounts(w.db, scope)).reduce((s, n) => s + n, 0)).toBe(total);
  });

  it('Bulk Update Return Info edits open RMAs, skips terminal ones and logs the change', async () => {
    const { orderId, lineId } = await shippedOrder(2);
    const open = await newRma(orderId, lineId, 1);
    const done = await newRma(orderId, lineId, 1);
    await withWriteTx(
      w.db,
      async (tx) => await changeReturnStatus(tx, ctx(), { ids: [done.id], status: 'Cancelled' }),
    );
    const res = await withWriteTx(
      w.db,
      async (tx) =>
        await bulkUpdateReturnInfo(tx, ctx(), {
          ids: [open.id, done.id],
          trackingNumber: '1ZRET',
          carrierCode: 'UPS',
        }),
    );
    expect(res.succeeded).toEqual([open.id]);
    expect(res.failed[0]?.code).toBe('INVALID_STATE');
    expect(await rma(open.id)).toMatchObject({ trackingNumber: '1ZRET', carrierCode: 'UPS' });
    expect((await rma(done.id))?.trackingNumber).toBeNull();
    const counts = await returnStatusCounts(w.db, scope, {
      ...EMPTY_GRID_QUERY,
      filters: [{ field: 'status', op: 'in', values: ['Pending'] }],
    } as never);
    expect(counts.Cancelled).toBe(1);
  });
});
