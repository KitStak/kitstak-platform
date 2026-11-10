/** Allocation rules/shortages, job creation and batching, task execution incl. pick-short. */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import * as schema from "@/server/db/schema";
import {
  allocateOrders, deallocate, EXPLANATION_OUT_OF_STOCK, EXPLANATION_SHORTAGE, eliminatedBy, loadAllocationAlgorithm,
} from "@/server/domain/allocation";
import { assign, cancelJob, createJobsFromOrders, getJobProgress, mergeIntoJob, removeOrderFromJob, unassign, updatePriority } from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { targetOrderStatus } from "@/server/domain/progress";
import { cancel, execute, update } from "@/server/domain/tasks";
import { createWorld, orderInput, type World } from "./fixtures";

let w: World;
beforeEach(() => { w = createWorld(); });
afterEach(() => w.close());

const stock = (qty: number, locationId = w.loc.storageA, extra: Record<string, unknown> = {}, productId = w.productId) =>
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId, locationId, qty, ...extra }).bucket;
const mkOrder = (qty: number, productId = w.productId, extra: Record<string, unknown> = {}) =>
  createOrder(w.db, w.ctx, orderInput(w, [{ productId, quantity: qty }], extra));
const orderRow = (id: string) => w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).get();
const tasksOf = (jobId: string, type?: string) => w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId)).all().filter((t) => !type || t.taskType === type);
const alloc = (ids: string[], extra: Record<string, unknown> = {}) => allocateOrders(w.db, w.ctx, { orderIds: ids, warehouseId: w.warehouseId, ...extra });
const clean = () => expect(ledger.reconcileLedger(w.db)).toEqual([]);

describe("allocation", () => {
  it("allocates FEFO across buckets", () => {
    const late = stock(3, w.loc.storageA, { expiryDate: "2028-01-01" });
    const early = stock(3, w.loc.storageB, { expiryDate: "2027-01-01" });
    const o = mkOrder(4);
    expect(alloc([o.id]).allocated).toEqual([o.id]);
    expect(w.db.select().from(schema.inventory).where(eq(schema.inventory.id, early.id)).get()?.allocated).toBe(3);
    expect(w.db.select().from(schema.inventory).where(eq(schema.inventory.id, late.id)).get()?.allocated).toBe(1);
    clean();
  });

  it("records shortages and Logiwa explanations", () => {
    stock(2);
    const o = mkOrder(5);
    const r = alloc([o.id]);
    expect(r.shortage).toEqual([o.id]);
    expect(orderRow(o.id)?.status).toBe("Shortage");
    const ex = w.db.select().from(schema.allocationExceptions).all();
    expect(ex.map((e) => e.explanation)).toEqual([EXPLANATION_SHORTAGE]);
    expect(ex[0].waveNo).toBe("Manual Allocation");
    const sh = w.db.select().from(schema.orderLineShortages).get();
    expect(sh).toMatchObject({ reason: "Insufficient Inventory", shortageQty: 3, freeQty: 2 });
    expect(w.db.select().from(schema.inventoryAllocations).all()).toHaveLength(0);
    stock(3);
    expect(alloc([o.id]).allocated).toEqual([o.id]);
    expect(w.db.select().from(schema.orderLineShortages).get()?.resolvedAt).not.toBeNull();
    clean();
  });

  it("writes out-of-stock, partial allocation and no-eligible-stock", () => {
    const o = mkOrder(1, w.product2Id);
    alloc([o.id]);
    expect(w.db.select().from(schema.allocationExceptions).all().map((e) => e.explanation)).toContain(EXPLANATION_OUT_OF_STOCK);
    stock(2);
    const p = mkOrder(3);
    expect(alloc([p.id], { mode: "partial" }).shortage).toEqual([p.id]);
    expect(w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, p.id)).get()?.allocatedQuantity).toBe(2);
    const q = mkOrder(1);
    w.db.update(schema.orderLines).set({ lotNumber: "NOPE" }).where(eq(schema.orderLines.orderId, q.id)).run();
    stock(5, w.loc.storageB);
    alloc([q.id]);
    expect(w.db.select().from(schema.orderLineShortages).where(eq(schema.orderLineShortages.orderId, q.id)).get()?.reason).toBe("No Eligible Stock Found");
  });

  it("evaluates algorithm rules and eliminations", () => {
    stock(5, w.loc.storageA);
    stock(5, w.loc.storageB);
    const algo = w.db.insert(schema.algorithms).values({ name: "Alloc", warehouseId: w.warehouseId, kind: "Allocation" }).returning().get();
    w.db.insert(schema.algorithmRules).values([
      { algorithmId: algo.id, sequence: 1, name: "VIP", conditions: [{ field: "priority", comparator: "equals", value: "Urgent" }], inventoryConditions: [{ field: "areaType", comparator: "in", value: ["Picking"] }], orderBy: [] },
      { algorithmId: algo.id, sequence: 2, name: "Big", conditions: [{ field: "orderQuantity", comparator: "gt", value: 100 }], inventoryConditions: [], orderBy: [] },
    ]).run();
    expect(loadAllocationAlgorithm(w.db, w.warehouseId).rules).toHaveLength(2);
    const vip = mkOrder(2, w.productId, { priority: "Urgent" });
    alloc([vip.id]);
    const a = w.db.select({ inv: schema.inventory }).from(schema.inventoryAllocations).innerJoin(schema.inventory, eq(schema.inventory.id, schema.inventoryAllocations.inventoryId)).get();
    expect(a?.inv.locationId).toBe(w.loc.storageB);
    const plain = mkOrder(1);
    alloc([plain.id]);
    expect(w.db.select().from(schema.allocationExceptions).where(eq(schema.allocationExceptions.orderId, plain.id)).get()?.explanation).toBe(eliminatedBy(["VIP", "Big"]));
    expect(() => loadAllocationAlgorithm(w.db, w.warehouseId, "missing")).toThrow(/not found/);
  });

  it("rejects ineligible orders and deallocates", () => {
    stock(5);
    const o = mkOrder(2);
    alloc([o.id]);
    const again = alloc([o.id, "missing"]);
    expect(again.failed.map((f) => f.code)).toEqual(["INVALID_STATE", "NOT_FOUND"]);
    const d = deallocate(w.db, w.ctx, { orderIds: [o.id, "missing"] });
    expect(d.succeeded).toEqual([o.id]);
    expect(orderRow(o.id)?.status).toBe("Open");
    expect(deallocate(w.db, w.ctx, { orderIds: [o.id] }).failed[0].code).toBe("INVALID_STATE");
    w.db.update(schema.shipmentOrders).set({ workflowBlocked: "Fully" }).where(eq(schema.shipmentOrders.id, o.id)).run();
    expect(alloc([o.id]).failed[0].message).toMatch(/blocked/);
    clean();
  });
});

describe("jobs", () => {
  const ready = (n: number, qty = 1) => {
    stock(50);
    const ids = Array.from({ length: n }, () => mkOrder(qty).id);
    alloc(ids);
    return ids;
  };

  it("batches by number of orders and plans tasks", () => {
    const ids = ready(3);
    const r = createJobsFromOrders(w.db, w.ctx, { orderIds: ids, jobTypeId: w.jobTypeId, batchSize: 2, now: new Date("2026-11-05T10:00:00Z") });
    expect(r.jobIds).toHaveLength(2);
    const job = w.db.select().from(schema.jobs).where(eq(schema.jobs.id, r.jobIds[0])).get();
    expect(job).toMatchObject({ orderCount: 2, taskCount: 4, unitCount: 2, plannedStartAt: "2026-11-05T11:00:00.000Z", plannedEndAt: "2026-11-05T12:00:00.000Z" });
    const t = tasksOf(r.jobIds[0]).sort((a, b) => a.sequence - b.sequence);
    expect(t[0].plannedFinishAt).toBe("2026-11-05T11:01:00.000Z");
    expect(orderRow(ids[0])?.jobId).toBe(r.jobIds[0]);
    expect(getJobProgress(w.db, w.ctx, r.jobIds[0])).toMatchObject({ taskCount: 4, completedTaskCount: 0, percent: 0 });
    const again = createJobsFromOrders(w.db, w.ctx, { orderIds: [ids[0]], jobTypeId: w.jobTypeId });
    expect(again.failed[0].message).toMatch(/already in a job/);
  });

  it("applies order scope, conditions, Nof Item batching and sorting/loading tasks", () => {
    const single = w.db.insert(schema.jobTypes).values({ code: "SGL", description: "s", warehouseId: w.warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({ orderScope: "Single Item Orders", picking: { createSortingTask: true, createLoadingTask: true }, batch: { method: "Nof Item", max: 2 } }) }).returning().get();
    const ids = ready(3);
    const multi = mkOrder(2);
    alloc([multi.id]);
    const r = createJobsFromOrders(w.db, w.ctx, { orderIds: [...ids, multi.id], jobTypeId: single.id });
    expect(r.failed.map((f) => f.id)).toEqual([multi.id]);
    expect(r.jobIds).toHaveLength(2);
    expect(tasksOf(r.jobIds[0]).map((t) => t.taskType).sort()).toEqual(["Loading", "Loading", "Packing", "Packing", "Picking", "Picking", "Sorting", "Sorting"]);
    const cond = w.db.insert(schema.jobTypes).values({ code: "CND", description: "c", warehouseId: w.warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({ orderScope: "Multi-Item Orders" }), conditions: [{ field: "priority", op: "eq", value: "High", label: "" }] }).returning().get();
    expect(createJobsFromOrders(w.db, w.ctx, { orderIds: [multi.id], jobTypeId: cond.id }).failed[0].message).toMatch(/conditions/);
    const ident = w.db.insert(schema.jobTypes).values({ code: "IDN", description: "i", warehouseId: w.warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({ orderScope: "Identical Item Orders", batch: { min: 2 } }) }).returning().get();
    expect(createJobsFromOrders(w.db, w.ctx, { orderIds: [multi.id], jobTypeId: ident.id }).failed[0].message).toMatch(/Fewer than 2/);
    w.db.update(schema.jobTypes).set({ isActive: false }).where(eq(schema.jobTypes.id, ident.id)).run();
    expect(() => createJobsFromOrders(w.db, w.ctx, { orderIds: [multi.id], jobTypeId: ident.id })).toThrow(/inactive/);
  });

  it("assigns, prioritises, merges, removes and cancels", () => {
    const ids = ready(3);
    const { jobIds: [jobId] } = createJobsFromOrders(w.db, w.ctx, { orderIds: ids.slice(0, 2), jobTypeId: w.jobTypeId });
    expect(assign(w.db, w.ctx, { jobIds: [jobId], userId: w.userId }).succeeded).toEqual([jobId]);
    const op = w.db.insert(schema.users).values({ email: "op@x.io", name: "Op", passwordHash: "x", role: "operator" }).returning().get();
    const wh2 = w.db.insert(schema.warehouses).values({ code: "W2", name: "W2", addressLine: "a", city: "c", state: "TN" }).returning().get();
    w.db.insert(schema.userWarehouses).values({ userId: op.id, warehouseId: wh2.id }).run();
    expect(assign(w.db, w.ctx, { jobIds: [jobId], userId: op.id }).failed[0].message).toMatch(/not assigned/);
    expect(unassign(w.db, w.ctx, { jobIds: [jobId] }).succeeded).toHaveLength(1);
    expect(updatePriority(w.db, w.ctx, { jobIds: [jobId, "nope"], priority: "High" }).failed).toHaveLength(1);
    expect(mergeIntoJob(w.db, w.ctx, { jobId, orderIds: [ids[2]] }).succeeded).toEqual([ids[2]]);
    removeOrderFromJob(w.db, w.ctx, { jobId, orderId: ids[2] });
    expect(orderRow(ids[2])).toMatchObject({ jobId: null, status: "Ready to Pick" });
    expect(() => removeOrderFromJob(w.db, w.ctx, { jobId, orderId: ids[2] })).toThrow(/not in this job/);
    cancelJob(w.db, w.ctx, { jobId });
    expect(orderRow(ids[0])).toMatchObject({ status: "Open", jobId: null });
    expect(w.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get()?.status).toBe("Cancelled");
    expect(() => cancelJob(w.db, w.ctx, { jobId })).toThrow(/Cancelled jobs/);
    clean();
  });
});

describe("tasks", () => {
  const setup = (qty: number, jobTypeId = w.jobTypeId) => {
    stock(qty + 5);
    const o = mkOrder(qty);
    alloc([o.id]);
    const { jobIds: [jobId] } = createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId });
    return { orderId: o.id, jobId };
  };

  it("derives order status from tasks", () => {
    const t = (taskType: string, status: string) => ({ taskType, status }) as Parameters<typeof targetOrderStatus>[0][number];
    expect(targetOrderStatus([])).toBeNull();
    expect(targetOrderStatus([t("Picking", "Pending")])).toBe("Ready to Pick");
    expect(targetOrderStatus([t("Picking", "Completed"), t("Picking", "Pending")])).toBe("Picking Started");
    expect(targetOrderStatus([t("Picking", "Completed"), t("Sorting", "Pending")])).toBe("Ready to Sort");
    expect(targetOrderStatus([t("Picking", "Completed"), t("Loading", "Started")])).toBe("Loading Started");
    expect(targetOrderStatus([t("Picking", "Completed")])).toBe("Ready to Ship");
  });

  it("runs sort -> pack -> load", () => {
    const jt = w.db.insert(schema.jobTypes).values({ code: "SPL", description: "x", warehouseId: w.warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({ picking: { createSortingTask: true, createLoadingTask: true } }) }).returning().get();
    const { orderId, jobId } = setup(2, jt.id);
    const run = (type: string, loc: string) => execute(w.db, w.ctx, { taskIds: tasksOf(jobId, type).map((x) => x.id), targetLocationId: loc });
    run("Picking", w.loc.pick);
    expect(orderRow(orderId)?.status).toBe("Ready to Sort");
    run("Sorting", w.loc.pick);
    expect(orderRow(orderId)?.status).toBe("Ready to Pack");
    run("Packing", w.loc.pack);
    expect(orderRow(orderId)?.status).toBe("Ready to Load");
    run("Loading", w.loc.ship);
    expect(orderRow(orderId)?.status).toBe("Ready to Ship");
    const line = w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, orderId)).get();
    expect(line).toMatchObject({ pickedQuantity: 2, sortedQuantity: 2, packedQuantity: 2, loadedQuantity: 2 });
    expect(() => run("Loading", w.loc.ship)).toThrow(/completed/);
    clean();
  });

  it("handles a pick-short with release and a resolution job", () => {
    const { orderId, jobId } = setup(4);
    stock(3, w.loc.storageB);
    const pick = tasksOf(jobId, "Picking")[0];
    const r = execute(w.db, w.ctx, { taskIds: [pick.id], targetLocationId: w.loc.pick, qty: 1, createResolutionJob: true, note: "empty bin" });
    expect(r[0]).toMatchObject({ doneQty: 1, shortQty: 3 });
    expect(r[0].resolutionJobId).toBeTruthy();
    const missing = w.db.select().from(schema.missingLog).get();
    expect(missing).toMatchObject({ missingQty: 3, notes: "empty bin", locationId: pick.sourceLocationId });
    expect(orderRow(orderId)?.pickShortStatus).toBe("Open");
    const resolution = w.db.select().from(schema.jobs).where(eq(schema.jobs.id, r[0].resolutionJobId as string)).get();
    expect(resolution?.isResolutionJob).toBe(true);
    expect(orderRow(orderId)?.status).toBe("Picking Started");
    const rt = tasksOf(resolution?.id as string, "Picking");
    execute(w.db, w.ctx, { taskIds: rt.map((x) => x.id), targetLocationId: w.loc.pick });
    expect(orderRow(orderId)?.status).toBe("Ready to Pack");
    expect(w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, orderId)).get()?.pickedQuantity).toBe(4);
    clean();
  });

  it("pick-short without resolution releases and lowers downstream qty", () => {
    const { orderId, jobId } = setup(3);
    execute(w.db, w.ctx, { taskIds: [tasksOf(jobId, "Picking")[0].id], targetLocationId: w.loc.pick, qty: 2 });
    expect(tasksOf(jobId, "Packing")[0].plannedQty).toBe(2);
    expect(w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, orderId)).get()?.allocatedQuantity).toBe(2);
    expect(() => execute(w.db, w.ctx, { taskIds: [tasksOf(jobId, "Packing")[0].id], targetLocationId: w.loc.pack, qty: 9 })).toThrow(/between 0 and 2/);
    execute(w.db, w.ctx, { taskIds: [tasksOf(jobId, "Packing")[0].id], targetLocationId: w.loc.pack, qty: 1 });
    expect(orderRow(orderId)?.packShortStatus).toBe("Open");
    clean();
  });

  it("retains the allocation during missing when the client asks", () => {
    w.db.update(schema.clients).set({ settings: { fulfillment: { retainAllocationDuringMissing: true } } }).where(eq(schema.clients.id, w.clientId)).run();
    const { orderId, jobId } = setup(2);
    execute(w.db, w.ctx, { taskIds: [tasksOf(jobId, "Picking")[0].id], targetLocationId: w.loc.pick, qty: 0 });
    expect(w.db.select().from(schema.missingLog).get()?.isRetain).toBe(true);
    expect(w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, orderId)).get()?.allocatedQuantity).toBe(2);
  });

  it("updates and cancels pending tasks", () => {
    const { orderId, jobId } = setup(1);
    const pick = tasksOf(jobId, "Picking")[0];
    expect(update(w.db, w.ctx, { taskId: pick.id, targetLocationId: w.loc.pick }).targetLocationId).toBe(w.loc.pick);
    const other = setup(1);
    const moved = update(w.db, w.ctx, { taskId: pick.id, moveToJobId: other.jobId });
    expect(moved.jobId).toBe(other.jobId);
    expect(() => update(w.db, w.ctx, { taskId: "nope" })).toThrow(/not found/);
    expect(cancel(w.db, w.ctx, { taskIds: [pick.id] })).toBe(1);
    expect(orderRow(orderId)).toMatchObject({ status: "Open", jobId: null });
    expect(() => cancel(w.db, w.ctx, { taskIds: [pick.id] })).toThrow(/Only pending/);
    expect(() => execute(w.db, w.ctx, { taskIds: [], targetLocationId: w.loc.pick })).toThrow(/at least one/);
    const stub = w.db.insert(schema.tasks).values({ taskNo: 9999, jobId, warehouseId: w.warehouseId, taskType: "Count" }).returning().get();
    expect(() => execute(w.db, w.ctx, { taskIds: [stub.id], targetLocationId: w.loc.pick })).toThrow(/not configured yet/);
    expect(w.db.select().from(schema.tasks).where(and(eq(schema.tasks.orderId, orderId), eq(schema.tasks.status, "Pending"))).all()).toHaveLength(0);
    clean();
  });
});
