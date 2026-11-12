/** Allocation rules/shortages, job creation and batching, task execution incl. pick-short. */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobTypeSettingsSchema } from '@/lib/domain-types';
import * as schema from '@/server/db/schema';
import {
  allocateOrders,
  deallocate,
  EXPLANATION_OUT_OF_STOCK,
  EXPLANATION_SHORTAGE,
  eliminatedBy,
  loadAllocationAlgorithm,
} from '@/server/domain/allocation';
import {
  assign,
  cancelJob,
  createJobsFromOrders,
  getJobProgress,
  mergeIntoJob,
  removeOrderFromJob,
  unassign,
  updatePriority,
} from '@/server/domain/jobs';
import { ledger } from '@/server/domain/ledger';
import { createOrder } from '@/server/domain/orders';
import { targetOrderStatus } from '@/server/domain/progress';
import { cancel, execute, update } from '@/server/domain/tasks';
import { createWorld, orderInput, type World } from './fixtures';
import { mapSeq } from '@/server/db/sql';

let w: World;
beforeEach(async () => {
  w = await createWorld();
});
afterEach(() => w.close());

const stock = async (
  qty: number,
  locationId = w.loc.storageA,
  extra: Record<string, unknown> = {},
  productId = w.productId,
) =>
  (
    await ledger.add(w.db, w.ctx, {
      warehouseId: w.warehouseId,
      clientId: w.clientId,
      productId,
      locationId,
      qty,
      ...extra,
    })
  ).bucket;
const mkOrder = async (qty: number, productId = w.productId, extra: Record<string, unknown> = {}) =>
  await createOrder(w.db, w.ctx, orderInput(w, [{ productId, quantity: qty }], extra));
const orderRow = async (id: string) =>
  (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).limit(1))[0];
const tasksOf = async (jobId: string, type?: string) =>
  (await w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId))).filter(
    (t) => !type || t.taskType === type,
  );
const alloc = async (ids: string[], extra: Record<string, unknown> = {}) =>
  await allocateOrders(w.db, w.ctx, { orderIds: ids, warehouseId: w.warehouseId, ...extra });
const clean = async () => expect(await ledger.reconcileLedger(w.db)).toEqual([]);

describe('allocation', () => {
  it('allocates FEFO across buckets', async () => {
    const late = await stock(3, w.loc.storageA, { expiryDate: '2028-01-01' });
    const early = await stock(3, w.loc.storageB, { expiryDate: '2027-01-01' });
    const o = await mkOrder(4);
    expect((await alloc([o.id])).allocated).toEqual([o.id]);
    expect(
      (await w.db.select().from(schema.inventory).where(eq(schema.inventory.id, early.id)).limit(1))[0]
        ?.allocated,
    ).toBe(3);
    expect(
      (await w.db.select().from(schema.inventory).where(eq(schema.inventory.id, late.id)).limit(1))[0]
        ?.allocated,
    ).toBe(1);
    await clean();
  });

  it('records shortages and Logiwa explanations', async () => {
    await stock(2);
    const o = await mkOrder(5);
    const r = await alloc([o.id]);
    expect(r.shortage).toEqual([o.id]);
    expect((await orderRow(o.id))?.status).toBe('Shortage');
    const ex = await w.db.select().from(schema.allocationExceptions);
    expect(ex.map((e) => e.explanation)).toEqual([EXPLANATION_SHORTAGE]);
    expect(ex[0].waveNo).toBe('Manual Allocation');
    const sh = (await w.db.select().from(schema.orderLineShortages).limit(1))[0];
    expect(sh).toMatchObject({ reason: 'Insufficient Inventory', shortageQty: 3, freeQty: 2 });
    expect(await w.db.select().from(schema.inventoryAllocations)).toHaveLength(0);
    await stock(3);
    expect((await alloc([o.id])).allocated).toEqual([o.id]);
    expect((await w.db.select().from(schema.orderLineShortages).limit(1))[0]?.resolvedAt).not.toBeNull();
    await clean();
  });

  it('writes out-of-stock, partial allocation and no-eligible-stock', async () => {
    const o = await mkOrder(1, w.product2Id);
    await alloc([o.id]);
    expect((await w.db.select().from(schema.allocationExceptions)).map((e) => e.explanation)).toContain(
      EXPLANATION_OUT_OF_STOCK,
    );
    await stock(2);
    const p = await mkOrder(3);
    expect((await alloc([p.id], { mode: 'partial' })).shortage).toEqual([p.id]);
    expect(
      (await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, p.id)).limit(1))[0]
        ?.allocatedQuantity,
    ).toBe(2);
    const q = await mkOrder(1);
    await w.db
      .update(schema.orderLines)
      .set({ lotNumber: 'NOPE' })
      .where(eq(schema.orderLines.orderId, q.id));
    await stock(5, w.loc.storageB);
    await alloc([q.id]);
    expect(
      (
        await w.db
          .select()
          .from(schema.orderLineShortages)
          .where(eq(schema.orderLineShortages.orderId, q.id))
          .limit(1)
      )[0]?.reason,
    ).toBe('No Eligible Stock Found');
  });

  it('evaluates algorithm rules and eliminations', async () => {
    await stock(5, w.loc.storageA);
    await stock(5, w.loc.storageB);
    const algo = (
      await w.db
        .insert(schema.algorithms)
        .values({ name: 'Alloc', warehouseId: w.warehouseId, kind: 'Allocation' })
        .returning()
    )[0];
    await w.db.insert(schema.algorithmRules).values([
      {
        algorithmId: algo.id,
        sequence: 1,
        name: 'VIP',
        conditions: [{ field: 'priority', comparator: 'equals', value: 'Urgent' }],
        inventoryConditions: [{ field: 'areaType', comparator: 'in', value: ['Picking'] }],
        orderBy: [],
      },
      {
        algorithmId: algo.id,
        sequence: 2,
        name: 'Big',
        conditions: [{ field: 'orderQuantity', comparator: 'gt', value: 100 }],
        inventoryConditions: [],
        orderBy: [],
      },
    ]);
    expect((await loadAllocationAlgorithm(w.db, w.warehouseId)).rules).toHaveLength(2);
    const vip = await mkOrder(2, w.productId, { priority: 'Urgent' });
    await alloc([vip.id]);
    const a = (
      await w.db
        .select({ inv: schema.inventory })
        .from(schema.inventoryAllocations)
        .innerJoin(schema.inventory, eq(schema.inventory.id, schema.inventoryAllocations.inventoryId))
        .limit(1)
    )[0];
    expect(a?.inv.locationId).toBe(w.loc.storageB);
    const plain = await mkOrder(1);
    await alloc([plain.id]);
    expect(
      (
        await w.db
          .select()
          .from(schema.allocationExceptions)
          .where(eq(schema.allocationExceptions.orderId, plain.id))
          .limit(1)
      )[0]?.explanation,
    ).toBe(eliminatedBy(['VIP', 'Big']));
    await expect(async () => await loadAllocationAlgorithm(w.db, w.warehouseId, 'missing')).rejects.toThrow(
      /not found/,
    );
  });

  it('rejects ineligible orders and deallocates', async () => {
    await stock(5);
    const o = await mkOrder(2);
    await alloc([o.id]);
    const again = await alloc([o.id, 'missing']);
    expect(again.failed.map((f) => f.code)).toEqual(['INVALID_STATE', 'NOT_FOUND']);
    const d = await deallocate(w.db, w.ctx, { orderIds: [o.id, 'missing'] });
    expect(d.succeeded).toEqual([o.id]);
    expect((await orderRow(o.id))?.status).toBe('Open');
    expect((await deallocate(w.db, w.ctx, { orderIds: [o.id] })).failed[0].code).toBe('INVALID_STATE');
    await w.db
      .update(schema.shipmentOrders)
      .set({ workflowBlocked: 'Fully' })
      .where(eq(schema.shipmentOrders.id, o.id));
    expect((await alloc([o.id])).failed[0].message).toMatch(/blocked/);
    await clean();
  });
});

describe('jobs', () => {
  const ready = async (n: number, qty = 1) => {
    await stock(50);
    const ids = await mapSeq(Array.from({ length: n }), async () => (await mkOrder(qty)).id);
    await alloc(ids);
    return ids;
  };

  it('batches by number of orders and plans tasks', async () => {
    const ids = await ready(3);
    const r = await createJobsFromOrders(w.db, w.ctx, {
      orderIds: ids,
      jobTypeId: w.jobTypeId,
      batchSize: 2,
      now: new Date('2026-11-05T10:00:00Z'),
    });
    expect(r.jobIds).toHaveLength(2);
    const job = (await w.db.select().from(schema.jobs).where(eq(schema.jobs.id, r.jobIds[0])).limit(1))[0];
    expect(job).toMatchObject({
      orderCount: 2,
      taskCount: 4,
      unitCount: 2,
      plannedStartAt: '2026-11-05T11:00:00.000Z',
      plannedEndAt: '2026-11-05T12:00:00.000Z',
    });
    const t = (await tasksOf(r.jobIds[0])).sort((a, b) => a.sequence - b.sequence);
    expect(t[0].plannedFinishAt).toBe('2026-11-05T11:01:00.000Z');
    expect((await orderRow(ids[0]))?.jobId).toBe(r.jobIds[0]);
    expect(await getJobProgress(w.db, w.ctx, r.jobIds[0])).toMatchObject({
      taskCount: 4,
      completedTaskCount: 0,
      percent: 0,
    });
    const again = await createJobsFromOrders(w.db, w.ctx, { orderIds: [ids[0]], jobTypeId: w.jobTypeId });
    expect(again.failed[0].message).toMatch(/already in a job/);
  });

  it('applies order scope, conditions, Nof Item batching and sorting/loading tasks', async () => {
    const single = (
      await w.db
        .insert(schema.jobTypes)
        .values({
          code: 'SGL',
          description: 's',
          warehouseId: w.warehouseId,
          operationType: 'Picking',
          settings: jobTypeSettingsSchema.parse({
            orderScope: 'Single Item Orders',
            picking: { createSortingTask: true, createLoadingTask: true },
            batch: { method: 'Nof Item', max: 2 },
          }),
        })
        .returning()
    )[0];
    const ids = await ready(3);
    const multi = await mkOrder(2);
    await alloc([multi.id]);
    const r = await createJobsFromOrders(w.db, w.ctx, { orderIds: [...ids, multi.id], jobTypeId: single.id });
    expect(r.failed.map((f) => f.id)).toEqual([multi.id]);
    expect(r.jobIds).toHaveLength(2);
    expect((await tasksOf(r.jobIds[0])).map((t) => t.taskType).sort()).toEqual([
      'Loading',
      'Loading',
      'Packing',
      'Packing',
      'Picking',
      'Picking',
      'Sorting',
      'Sorting',
    ]);
    const cond = (
      await w.db
        .insert(schema.jobTypes)
        .values({
          code: 'CND',
          description: 'c',
          warehouseId: w.warehouseId,
          operationType: 'Picking',
          settings: jobTypeSettingsSchema.parse({ orderScope: 'Multi-Item Orders' }),
          conditions: [{ field: 'priority', op: 'eq', value: 'High', label: '' }],
        })
        .returning()
    )[0];
    expect(
      (await createJobsFromOrders(w.db, w.ctx, { orderIds: [multi.id], jobTypeId: cond.id })).failed[0]
        .message,
    ).toMatch(/conditions/);
    const ident = (
      await w.db
        .insert(schema.jobTypes)
        .values({
          code: 'IDN',
          description: 'i',
          warehouseId: w.warehouseId,
          operationType: 'Picking',
          settings: jobTypeSettingsSchema.parse({ orderScope: 'Identical Item Orders', batch: { min: 2 } }),
        })
        .returning()
    )[0];
    expect(
      (await createJobsFromOrders(w.db, w.ctx, { orderIds: [multi.id], jobTypeId: ident.id })).failed[0]
        .message,
    ).toMatch(/Fewer than 2/);
    await w.db.update(schema.jobTypes).set({ isActive: false }).where(eq(schema.jobTypes.id, ident.id));
    await expect(
      async () => await createJobsFromOrders(w.db, w.ctx, { orderIds: [multi.id], jobTypeId: ident.id }),
    ).rejects.toThrow(/inactive/);
  });

  it('assigns, prioritises, merges, removes and cancels', async () => {
    const ids = await ready(3);
    const {
      jobIds: [jobId],
    } = await createJobsFromOrders(w.db, w.ctx, { orderIds: ids.slice(0, 2), jobTypeId: w.jobTypeId });
    expect((await assign(w.db, w.ctx, { jobIds: [jobId], userId: w.userId })).succeeded).toEqual([jobId]);
    const op = (
      await w.db
        .insert(schema.users)
        .values({ email: 'op@x.io', name: 'Op', passwordHash: 'x', role: 'operator' })
        .returning()
    )[0];
    const wh2 = (
      await w.db
        .insert(schema.warehouses)
        .values({ code: 'W2', name: 'W2', addressLine: 'a', city: 'c', state: 'TN' })
        .returning()
    )[0];
    await w.db.insert(schema.userWarehouses).values({ userId: op.id, warehouseId: wh2.id });
    expect((await assign(w.db, w.ctx, { jobIds: [jobId], userId: op.id })).failed[0].message).toMatch(
      /not assigned/,
    );
    expect((await unassign(w.db, w.ctx, { jobIds: [jobId] })).succeeded).toHaveLength(1);
    expect(
      (await updatePriority(w.db, w.ctx, { jobIds: [jobId, 'nope'], priority: 'High' })).failed,
    ).toHaveLength(1);
    expect((await mergeIntoJob(w.db, w.ctx, { jobId, orderIds: [ids[2]] })).succeeded).toEqual([ids[2]]);
    await removeOrderFromJob(w.db, w.ctx, { jobId, orderId: ids[2] });
    expect(await orderRow(ids[2])).toMatchObject({ jobId: null, status: 'Ready to Pick' });
    await expect(
      async () => await removeOrderFromJob(w.db, w.ctx, { jobId, orderId: ids[2] }),
    ).rejects.toThrow(/not in this job/);
    await cancelJob(w.db, w.ctx, { jobId });
    expect(await orderRow(ids[0])).toMatchObject({ status: 'Open', jobId: null });
    expect((await w.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1))[0]?.status).toBe(
      'Cancelled',
    );
    await expect(async () => await cancelJob(w.db, w.ctx, { jobId })).rejects.toThrow(/Cancelled jobs/);
    await clean();
  });
});

describe('tasks', () => {
  const setup = async (qty: number, jobTypeId = w.jobTypeId) => {
    await stock(qty + 5);
    const o = await mkOrder(qty);
    await alloc([o.id]);
    const {
      jobIds: [jobId],
    } = await createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId });
    return { orderId: o.id, jobId };
  };

  it('derives order status from tasks', () => {
    const t = (taskType: string, status: string) =>
      ({ taskType, status }) as Parameters<typeof targetOrderStatus>[0][number];
    expect(targetOrderStatus([])).toBeNull();
    expect(targetOrderStatus([t('Picking', 'Pending')])).toBe('Ready to Pick');
    expect(targetOrderStatus([t('Picking', 'Completed'), t('Picking', 'Pending')])).toBe('Picking Started');
    expect(targetOrderStatus([t('Picking', 'Completed'), t('Sorting', 'Pending')])).toBe('Ready to Sort');
    expect(targetOrderStatus([t('Picking', 'Completed'), t('Loading', 'Started')])).toBe('Loading Started');
    expect(targetOrderStatus([t('Picking', 'Completed')])).toBe('Ready to Ship');
  });

  it('runs sort -> pack -> load', async () => {
    const jt = (
      await w.db
        .insert(schema.jobTypes)
        .values({
          code: 'SPL',
          description: 'x',
          warehouseId: w.warehouseId,
          operationType: 'Picking',
          settings: jobTypeSettingsSchema.parse({
            picking: { createSortingTask: true, createLoadingTask: true },
          }),
        })
        .returning()
    )[0];
    const { orderId, jobId } = await setup(2, jt.id);
    const run = async (type: string, loc: string) =>
      await execute(w.db, w.ctx, {
        taskIds: (await tasksOf(jobId, type)).map((x) => x.id),
        targetLocationId: loc,
      });
    await run('Picking', w.loc.pick);
    expect((await orderRow(orderId))?.status).toBe('Ready to Sort');
    await run('Sorting', w.loc.pick);
    expect((await orderRow(orderId))?.status).toBe('Ready to Pack');
    await run('Packing', w.loc.pack);
    expect((await orderRow(orderId))?.status).toBe('Ready to Load');
    await run('Loading', w.loc.ship);
    expect((await orderRow(orderId))?.status).toBe('Ready to Ship');
    const line = (
      await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, orderId)).limit(1)
    )[0];
    expect(line).toMatchObject({
      pickedQuantity: 2,
      sortedQuantity: 2,
      packedQuantity: 2,
      loadedQuantity: 2,
    });
    await expect(async () => await run('Loading', w.loc.ship)).rejects.toThrow(/completed/);
    await clean();
  });

  it('handles a pick-short with release and a resolution job', async () => {
    const { orderId, jobId } = await setup(4);
    await stock(3, w.loc.storageB);
    const pick = (await tasksOf(jobId, 'Picking'))[0];
    const r = await execute(w.db, w.ctx, {
      taskIds: [pick.id],
      targetLocationId: w.loc.pick,
      qty: 1,
      createResolutionJob: true,
      note: 'empty bin',
    });
    expect(r[0]).toMatchObject({ doneQty: 1, shortQty: 3 });
    expect(r[0].resolutionJobId).toBeTruthy();
    const missing = (await w.db.select().from(schema.missingLog).limit(1))[0];
    expect(missing).toMatchObject({ missingQty: 3, notes: 'empty bin', locationId: pick.sourceLocationId });
    expect((await orderRow(orderId))?.pickShortStatus).toBe('Open');
    const resolution = (
      await w.db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, r[0].resolutionJobId as string))
        .limit(1)
    )[0];
    expect(resolution?.isResolutionJob).toBe(true);
    expect((await orderRow(orderId))?.status).toBe('Picking Started');
    const rt = await tasksOf(resolution?.id as string, 'Picking');
    await execute(w.db, w.ctx, { taskIds: rt.map((x) => x.id), targetLocationId: w.loc.pick });
    expect((await orderRow(orderId))?.status).toBe('Ready to Pack');
    expect(
      (await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, orderId)).limit(1))[0]
        ?.pickedQuantity,
    ).toBe(4);
    await clean();
  });

  it('pick-short without resolution releases and lowers downstream qty', async () => {
    const { orderId, jobId } = await setup(3);
    await execute(w.db, w.ctx, {
      taskIds: [(await tasksOf(jobId, 'Picking'))[0].id],
      targetLocationId: w.loc.pick,
      qty: 2,
    });
    expect((await tasksOf(jobId, 'Packing'))[0].plannedQty).toBe(2);
    expect(
      (await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, orderId)).limit(1))[0]
        ?.allocatedQuantity,
    ).toBe(2);
    await expect(
      async () =>
        await execute(w.db, w.ctx, {
          taskIds: [(await tasksOf(jobId, 'Packing'))[0].id],
          targetLocationId: w.loc.pack,
          qty: 9,
        }),
    ).rejects.toThrow(/between 0 and 2/);
    await execute(w.db, w.ctx, {
      taskIds: [(await tasksOf(jobId, 'Packing'))[0].id],
      targetLocationId: w.loc.pack,
      qty: 1,
    });
    expect((await orderRow(orderId))?.packShortStatus).toBe('Open');
    await clean();
  });

  it('retains the allocation during missing when the client asks', async () => {
    await w.db
      .update(schema.clients)
      .set({ settings: { fulfillment: { retainAllocationDuringMissing: true } } })
      .where(eq(schema.clients.id, w.clientId));
    const { orderId, jobId } = await setup(2);
    await execute(w.db, w.ctx, {
      taskIds: [(await tasksOf(jobId, 'Picking'))[0].id],
      targetLocationId: w.loc.pick,
      qty: 0,
    });
    expect((await w.db.select().from(schema.missingLog).limit(1))[0]?.isRetain).toBe(true);
    expect(
      (await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, orderId)).limit(1))[0]
        ?.allocatedQuantity,
    ).toBe(2);
  });

  it('updates and cancels pending tasks', async () => {
    const { orderId, jobId } = await setup(1);
    const pick = (await tasksOf(jobId, 'Picking'))[0];
    expect(
      (await update(w.db, w.ctx, { taskId: pick.id, targetLocationId: w.loc.pick })).targetLocationId,
    ).toBe(w.loc.pick);
    const other = await setup(1);
    const moved = await update(w.db, w.ctx, { taskId: pick.id, moveToJobId: other.jobId });
    expect(moved.jobId).toBe(other.jobId);
    await expect(async () => await update(w.db, w.ctx, { taskId: 'nope' })).rejects.toThrow(/not found/);
    expect(await cancel(w.db, w.ctx, { taskIds: [pick.id] })).toBe(1);
    expect(await orderRow(orderId)).toMatchObject({ status: 'Open', jobId: null });
    await expect(async () => await cancel(w.db, w.ctx, { taskIds: [pick.id] })).rejects.toThrow(
      /Only pending/,
    );
    await expect(
      async () => await execute(w.db, w.ctx, { taskIds: [], targetLocationId: w.loc.pick }),
    ).rejects.toThrow(/at least one/);
    const stub = (
      await w.db
        .insert(schema.tasks)
        .values({ taskNo: 9999, jobId, warehouseId: w.warehouseId, taskType: 'Count' })
        .returning()
    )[0];
    await expect(
      async () => await execute(w.db, w.ctx, { taskIds: [stub.id], targetLocationId: w.loc.pick }),
    ).rejects.toThrow(/not linked to a count line/); // M07 count handler is registered
    expect(
      await w.db
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.orderId, orderId), eq(schema.tasks.status, 'Pending'))),
    ).toHaveLength(0);
    await clean();
  });
});
