import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { orderInput } from "../foundation/domain/fixtures";
import { call, closeWorld, cookieFor, current, expectGuarded, openWorld, removeFilesRoot, req } from "./harness";

vi.mock("@/server/api/db", () => ({ getAppDb: async () => current().db }));

const jobsRoute = await import("@/app/api/ops/jobs/route");
const eligibilityRoute = await import("@/app/api/ops/jobs/eligibility/route");
const allocateRoute = await import("@/app/api/ops/allocate/route");
const executeRoute = await import("@/app/api/ops/tasks/execute/route");
const updateRoute = await import("@/app/api/ops/tasks/update/route");
const cancelRoute = await import("@/app/api/ops/tasks/cancel/route");
const ratesRoute = await import("@/app/api/ops/shipping/rates/route");
const labelsRoute = await import("@/app/api/ops/shipping/labels/route");
const voidRoute = await import("@/app/api/ops/shipping/void/route");
const shipRoute = await import("@/app/api/ops/shipping/ship/route");
const returnRoute = await import("@/app/api/ops/shipping/return-label/route");
const eodRoute = await import("@/app/api/ops/shipping/close-eod/route");

beforeEach(async () => { await openWorld(); });
afterEach(() => closeWorld());
afterAll(() => removeFilesRoot());

const pkg = { weightOz: 20, length: 10, width: 8, height: 4 };

async function stockedOrder(qty = 2): Promise<string> {
  const w = current();
  await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: qty + 3 });
  return (await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }]))).id;
}

const post = async (route: { POST: Parameters<typeof call>[0] }, url: string, body: unknown, userId = current().operatorId) =>
  call(route.POST, req("POST", url, { cookie: await cookieFor(userId), body }));

const tasksOf = async (jobId: string, type: string) =>
  (await current().db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId))).filter((t) => t.taskType === type);

describe("/api/ops — allocate, jobs, tasks, shipping (operator)", () => {
  it("runs an order from allocation to shipped through the routes", async () => {
    const w = current();
    const orderId = await stockedOrder();

    const alloc = await post(allocateRoute, "/api/ops/allocate", { orderIds: [orderId], warehouseId: w.warehouseId });
    expect(alloc.status).toBe(200);
    expect(alloc.data).toMatchObject({ allocated: [orderId], failed: [] });

    const elig = await post(eligibilityRoute, "/api/ops/jobs/eligibility", { orderIds: [orderId, "nope"], jobTypeId: w.jobTypeId });
    expect(elig.data).toMatchObject({ total: 2, eligible: [orderId], jobCount: 1 });
    expect(await w.db.select().from(schema.jobs)).toHaveLength(0);

    const created = await post(jobsRoute, "/api/ops/jobs", { mode: "create", orderIds: [orderId], jobTypeId: w.jobTypeId });
    expect(created.status).toBe(200);
    const { jobIds } = created.data as { jobIds: string[] };
    expect(jobIds).toHaveLength(1);
    const jobId = jobIds[0] ?? "";

    const picking = (await tasksOf(jobId, "Picking")).map((t) => t.id);
    const moved = await post(updateRoute, "/api/ops/tasks/update", { taskId: picking[0], targetLocationId: w.loc.pick });
    expect(moved.status).toBe(200);
    expect((await post(executeRoute, "/api/ops/tasks/execute", { taskIds: picking, targetLocationId: w.loc.pick })).status).toBe(200);
    const packing = (await tasksOf(jobId, "Packing")).map((t) => t.id);
    expect((await post(executeRoute, "/api/ops/tasks/execute", { taskIds: packing, targetLocationId: w.loc.pack })).status).toBe(200);

    const rates = await post(ratesRoute, "/api/ops/shipping/rates", { orderId, packages: [pkg] });
    expect(rates.status).toBe(200);
    expect((rates.data as { quotes: unknown[] }).quotes.length).toBeGreaterThan(0);

    const label = await post(labelsRoute, "/api/ops/shipping/labels", {
      orderId, carrierConnectionId: w.carrierConnectionId, carrierServiceId: w.serviceIds.ground, packages: [pkg],
    });
    expect(label.status).toBe(201);
    const shipmentId = String((label.data as { shipments: { id: string }[] }).shipments[0]?.id);

    // Void Label is supervisor-only (shipping R3-1): the operator is refused, the manager voids.
    expect((await post(voidRoute, "/api/ops/shipping/void", { shipmentId })).status).toBe(403);
    const voided = await post(voidRoute, "/api/ops/shipping/void", { shipmentId }, w.userId);
    expect(voided.data).toEqual({ voided: 1 });
    const noLabel = await post(shipRoute, "/api/ops/shipping/ship", { ids: [orderId] });
    expect((noLabel.data as { failed: unknown[] }).failed).toHaveLength(1);
    await post(labelsRoute, "/api/ops/shipping/labels", {
      orderId, carrierConnectionId: w.carrierConnectionId, carrierServiceId: w.serviceIds.ground, packages: [pkg],
    });
    const shipped = await post(shipRoute, "/api/ops/shipping/ship", { ids: [orderId] });
    expect(shipped.data).toMatchObject({ succeeded: [orderId], failed: [] });
    expect((await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).limit(1))[0]?.status).toBe("Shipped");

    const ret = await post(returnRoute, "/api/ops/shipping/return-label", {
      orderId, carrierConnectionId: w.carrierConnectionId, carrierServiceId: w.serviceIds.ground, package: pkg,
    }, w.userId);
    expect(ret.status).toBe(201);

    const manifest = (await w.db.select().from(schema.endOfDayManifests).limit(1))[0];
    const closed = await post(eodRoute, "/api/ops/shipping/close-eod", { manifestId: manifest?.id }, w.userId);
    expect(closed.status).toBe(200);
    expect(closed.data).toMatchObject({ status: "Closed" });
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("merges, cancels tasks per id and reports missing work orders / count plans per id", async () => {
    const w = current();
    const first = await stockedOrder(1);
    const second = await stockedOrder(1);
    await post(allocateRoute, "/api/ops/allocate", { orderIds: [first, second], warehouseId: w.warehouseId });
    const created = await post(jobsRoute, "/api/ops/jobs", { mode: "create", orderIds: [first], jobTypeId: w.jobTypeId });
    const jobId = (created.data as { jobIds: string[] }).jobIds[0] ?? "";
    const merged = await post(jobsRoute, "/api/ops/jobs", { mode: "merge", jobId, orderIds: [second] });
    expect(merged.data).toMatchObject({ succeeded: [second], jobIds: [jobId] });

    const picking = (await tasksOf(jobId, "Picking")).map((t) => t.id);
    // Task cancel is a supervisor action (operator default no longer holds task_details.cancel_task).
    const cancelled = await post(cancelRoute, "/api/ops/tasks/cancel", { ids: [picking[0], "missing"] }, w.userId);
    expect(cancelled.data).toMatchObject({ succeeded: [picking[0]], failed: [{ id: "missing", code: "NOT_FOUND" }] });

    const wo = await post(jobsRoute, "/api/ops/jobs", { mode: "work-order", workOrderIds: ["wo-1"] });
    expect(wo.data).toMatchObject({ succeeded: [], failed: [{ id: "wo-1", code: "NOT_FOUND" }] });
    // count mode delegates to M07 (counts.md REQ-2): jobTypeId + batchSize are required
    expect((await post(jobsRoute, "/api/ops/jobs", { mode: "count", countPlanIds: ["c-1"] }, w.userId)).status).toBe(400);
    const count = await post(jobsRoute, "/api/ops/jobs", { mode: "count", countPlanIds: ["c-1"], jobTypeId: w.jobTypeId, batchSize: 10 }, w.userId);
    expect(count.data).toMatchObject({ succeeded: [], failed: [{ id: "c-1", code: "NOT_FOUND" }] });

    const dealloc = await post(allocateRoute, "/api/ops/allocate", { action: "deallocate", orderIds: [second] });
    expect(dealloc.status).toBe(200);
  });

  it("validates bodies and scope", async () => {
    const w = current();
    expect((await post(jobsRoute, "/api/ops/jobs", { mode: "create", orderIds: [] })).status).toBe(400);
    // without jobTypeId / jobId eligibility is the pre-check (orders-outbound REQ-5), so only an empty id list is a 400
    expect((await post(eligibilityRoute, "/api/ops/jobs/eligibility", { orderIds: [] })).status).toBe(400);
    expect((await post(allocateRoute, "/api/ops/allocate", { orderIds: ["a"], warehouseId: w.otherWarehouseId })).status).toBe(400);
    expect((await post(voidRoute, "/api/ops/shipping/void", { shipmentId: "missing" }, w.userId)).status).toBe(404);
    expect((await post(eodRoute, "/api/ops/shipping/close-eod", { manifestId: "missing" }, w.userId)).status).toBe(404);
  });
});

describe("/api/ops guards", () => {
  it("viewer gets 403 and missing CSRF gets 403 on every command", async () => {
    const id = "x";
    const cases: [{ POST: Parameters<typeof call>[0] }, string, unknown][] = [
      [jobsRoute, "/api/ops/jobs", { mode: "create", orderIds: [id], jobTypeId: id }],
      [eligibilityRoute, "/api/ops/jobs/eligibility", { orderIds: [id], jobTypeId: id }],
      [allocateRoute, "/api/ops/allocate", { orderIds: [id], warehouseId: id }],
      [executeRoute, "/api/ops/tasks/execute", { taskIds: [id], targetLocationId: id }],
      [updateRoute, "/api/ops/tasks/update", { taskId: id, targetLocationId: id }],
      [cancelRoute, "/api/ops/tasks/cancel", { ids: [id] }],
      [ratesRoute, "/api/ops/shipping/rates", { orderId: id, packages: [pkg] }],
      [labelsRoute, "/api/ops/shipping/labels", { orderId: id, carrierConnectionId: id, carrierServiceId: id, packages: [pkg] }],
      [voidRoute, "/api/ops/shipping/void", { shipmentId: id }],
      [shipRoute, "/api/ops/shipping/ship", { ids: [id] }],
      [returnRoute, "/api/ops/shipping/return-label", { orderId: id, carrierConnectionId: id, carrierServiceId: id, package: pkg }],
      [eodRoute, "/api/ops/shipping/close-eod", { manifestId: id }],
    ];
    for (const [route, url, body] of cases) await expectGuarded(route.POST, "POST", url, body);
  });
});
