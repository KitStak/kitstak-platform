/** F-patch round 1: shared changes requested by M03, M06, M07 and M08 (docs/requests/*.md). */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { stateMachines } from "@/server/domain/state-machines";
import { countLockFor, ledger } from "@/server/domain/ledger";
import { createOrder, mergeOrders, unmergeOrder } from "@/server/domain/orders";
import { recordWorkOrderException } from "@/server/domain/allocation";
import { createCountPlan } from "@/server/repositories/counts-plans";
import { compileOrderGrid } from "@/server/repositories/orders-grid";
import { eligibilitySchema, opsJobsSchema } from "@/server/repositories/platform-ops";
import { parseGridQuery } from "@/server/query/grid-query";
import { createWorld, orderInput, type World } from "./domain/fixtures";

let w: World;
let auth: AuthContext;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const stock = async (qty: number, locationId: string, productId = w.productId) =>
  await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId, locationId, qty });

describe("count-plan location locks in the ledger (counts REQ-1)", () => {
  it("blocks moves in and out and allocation, names the plan, and still allows in-place count posting", async () => {
    const { bucket } = await stock(10, w.loc.storageA);
    await createCountPlan(w.db, w.ctx, auth, {
      code: "CNT-LOCK-1", warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: true,
      countType: "Location", locationIds: [w.loc.storageA], productIds: [],
    });
    expect(await countLockFor(w.db, w.loc.storageA)).toBe("CNT-LOCK-1");
    await expect(async () => await ledger.move(w.db, w.ctx, { inventoryId: bucket.id, qty: 2, toLocationId: w.loc.storageB })).rejects.toThrow(/locked by count plan CNT-LOCK-1/);
    const other = (await stock(3, w.loc.storageB)).bucket;
    await expect(async () => await ledger.move(w.db, w.ctx, { inventoryId: other.id, qty: 1, toLocationId: w.loc.storageA })).rejects.toThrow(/locked by count plan CNT-LOCK-1/);
    await expect(async () => await ledger.allocate(w.db, w.ctx, { inventoryId: bucket.id, qty: 1 })).rejects.toThrow(/locked by count plan/);
    expect((await ledger.adjustTo(w.db, w.ctx, { inventoryId: bucket.id, targetQty: 8, type: "Count" })).bucket.onHand).toBe(8);
  });

  it("does not lock when the plan does not lock locations", async () => {
    await stock(5, w.loc.storageA);
    await createCountPlan(w.db, w.ctx, auth, {
      code: "CNT-OPEN-1", warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: false,
      countType: "Location", locationIds: [w.loc.storageA], productIds: [],
    });
    expect(await countLockFor(w.db, w.loc.storageA)).toBeNull();
  });
});

describe("orders.mergeOrders (fulfillment-jobs REQ-3)", () => {
  it("merges children onto the master and unmerge restores them", async () => {
    const master = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }], { skipAddressVerification: true }));
    const child = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.product2Id, quantity: 3 }], { skipAddressVerification: true }));
    expect((await mergeOrders(w.db, w.ctx, { masterOrderId: master.id, childOrderIds: [child.id] })).merged).toEqual([child.id]);
    const m = (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, master.id)).limit(1))[0];
    const c = (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, child.id)).limit(1))[0];
    expect(m).toMatchObject({ isMerged: true, totalQuantity: 5 });
    expect(c).toMatchObject({ status: "On Hold", mergedIntoOrderId: master.id });
    const copied = await w.db.select().from(schema.orderLines).where(and(eq(schema.orderLines.orderId, master.id), eq(schema.orderLines.originalOrderCode, child.code)));
    expect(copied).toHaveLength(1);
    await expect(async () => await mergeOrders(w.db, w.ctx, { masterOrderId: master.id, childOrderIds: [child.id] })).rejects.toThrow(/Only Open orders/);
    expect((await unmergeOrder(w.db, w.ctx, { orderId: master.id })).restored).toEqual([child.id]);
    expect((await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, child.id)).limit(1))[0]?.status).toBe("Open");
  });
});

describe("work orders (work-orders-kitting REQ-1, REQ-2)", () => {
  it("allows In Process -> Open unless kits were built", () => {
    expect(stateMachines.workOrder.canTransition("In Process", "Open").ok).toBe(true);
    expect(stateMachines.workOrder.canTransition("In Process", "Open", { processedQty: 2 }).ok).toBe(false);
  });

  it("writes the Manual Allocation - Work Order exception row", async () => {
    await recordWorkOrderException(w.db, w.ctx, {
      workOrder: { id: "wo-1", warehouseId: w.warehouseId, clientId: w.clientId }, productId: w.productId,
      inventoryQty: 3, requiredQty: 10, explanation: "Shortage",
    });
    const row = (await w.db.select().from(schema.allocationExceptions).limit(1))[0];
    expect(row).toMatchObject({ orderId: "wo-1", waveNo: "Manual Allocation - Work Order", algorithmName: "Work order components", orderLineQty: 10, inventoryUomQty: 3, runBy: "admin@test.io" });
  });
});

describe("ops jobs schemas accept the shared modal's shape (counts REQ-2, work-orders-kitting REQ-3)", () => {
  it("maps ids and operation onto the command modes", () => {
    expect(opsJobsSchema.parse({ operation: "work-order", mode: "create", ids: ["a"], jobTypeId: "jt" })).toMatchObject({ mode: "work-order", workOrderIds: ["a"], jobTypeId: "jt" });
    expect(opsJobsSchema.parse({ operation: "count", mode: "create", ids: ["p"], jobTypeId: "jt", batchSize: 10 })).toMatchObject({ mode: "count", countPlanIds: ["p"], batchSize: 10 });
    expect(opsJobsSchema.parse({ operation: "order", mode: "create", ids: ["o"], jobTypeId: "jt" })).toMatchObject({ mode: "create", orderIds: ["o"] });
    expect(eligibilitySchema.parse({ operation: "work-order", ids: ["a"] })).toMatchObject({ operation: "work-order", orderIds: ["a"] });
    expect(eligibilitySchema.safeParse({ operation: "order", ids: ["a"], jobTypeId: "t", jobId: "j" }).success).toBe(false);
    expect(eligibilitySchema.parse({ operation: "order", ids: ["a"] })).toMatchObject({ orderIds: ["a"] });
  });
});

describe("orders grid line-wise SKU filter (inventory REQ-2)", () => {
  it("matches a multi-line order by any of its SKUs", async () => {
    const multi = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }, { productId: w.product2Id, quantity: 1 }], { skipAddressVerification: true }));
    const single = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }], { skipAddressVerification: true }));
    const codes = async (params: string) => {
      const { where } = compileOrderGrid(parseGridQuery(new URLSearchParams(params)).query);
      return (await w.db.select({ code: schema.shipmentOrders.code }).from(schema.shipmentOrders).where(where)).map((r) => r.code).sort();
    };
    expect(await codes("f.sku=eq:MLT-WIDGET-01")).toEqual([multi.code, single.code].sort());
    expect(await codes("f.sku=eq:MLT-GADGET-02")).toEqual([multi.code]);
    expect(await codes("f.sku=nin:MLT-GADGET-02")).toEqual([single.code]);
  });
});
