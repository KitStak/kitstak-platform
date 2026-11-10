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

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const stock = (qty: number, locationId: string, productId = w.productId) =>
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId, locationId, qty });

describe("count-plan location locks in the ledger (counts REQ-1)", () => {
  it("blocks moves in and out and allocation, names the plan, and still allows in-place count posting", () => {
    const { bucket } = stock(10, w.loc.storageA);
    createCountPlan(w.db, w.ctx, auth, {
      code: "CNT-LOCK-1", warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: true,
      countType: "Location", locationIds: [w.loc.storageA], productIds: [],
    });
    expect(countLockFor(w.db, w.loc.storageA)).toBe("CNT-LOCK-1");
    expect(() => ledger.move(w.db, w.ctx, { inventoryId: bucket.id, qty: 2, toLocationId: w.loc.storageB })).toThrow(/locked by count plan CNT-LOCK-1/);
    const other = stock(3, w.loc.storageB).bucket;
    expect(() => ledger.move(w.db, w.ctx, { inventoryId: other.id, qty: 1, toLocationId: w.loc.storageA })).toThrow(/locked by count plan CNT-LOCK-1/);
    expect(() => ledger.allocate(w.db, w.ctx, { inventoryId: bucket.id, qty: 1 })).toThrow(/locked by count plan/);
    expect(ledger.adjustTo(w.db, w.ctx, { inventoryId: bucket.id, targetQty: 8, type: "Count" }).bucket.onHand).toBe(8);
  });

  it("does not lock when the plan does not lock locations", () => {
    stock(5, w.loc.storageA);
    createCountPlan(w.db, w.ctx, auth, {
      code: "CNT-OPEN-1", warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: false,
      countType: "Location", locationIds: [w.loc.storageA], productIds: [],
    });
    expect(countLockFor(w.db, w.loc.storageA)).toBeNull();
  });
});

describe("orders.mergeOrders (fulfillment-jobs REQ-3)", () => {
  it("merges children onto the master and unmerge restores them", () => {
    const master = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }], { skipAddressVerification: true }));
    const child = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.product2Id, quantity: 3 }], { skipAddressVerification: true }));
    expect(mergeOrders(w.db, w.ctx, { masterOrderId: master.id, childOrderIds: [child.id] }).merged).toEqual([child.id]);
    const m = w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, master.id)).get();
    const c = w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, child.id)).get();
    expect(m).toMatchObject({ isMerged: true, totalQuantity: 5 });
    expect(c).toMatchObject({ status: "On Hold", mergedIntoOrderId: master.id });
    const copied = w.db.select().from(schema.orderLines).where(and(eq(schema.orderLines.orderId, master.id), eq(schema.orderLines.originalOrderCode, child.code))).all();
    expect(copied).toHaveLength(1);
    expect(() => mergeOrders(w.db, w.ctx, { masterOrderId: master.id, childOrderIds: [child.id] })).toThrow(/Only Open orders/);
    expect(unmergeOrder(w.db, w.ctx, { orderId: master.id }).restored).toEqual([child.id]);
    expect(w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, child.id)).get()?.status).toBe("Open");
  });
});

describe("work orders (work-orders-kitting REQ-1, REQ-2)", () => {
  it("allows In Process -> Open unless kits were built", () => {
    expect(stateMachines.workOrder.canTransition("In Process", "Open").ok).toBe(true);
    expect(stateMachines.workOrder.canTransition("In Process", "Open", { processedQty: 2 }).ok).toBe(false);
  });

  it("writes the Manual Allocation - Work Order exception row", () => {
    recordWorkOrderException(w.db, w.ctx, {
      workOrder: { id: "wo-1", warehouseId: w.warehouseId, clientId: w.clientId }, productId: w.productId,
      inventoryQty: 3, requiredQty: 10, explanation: "Shortage",
    });
    const row = w.db.select().from(schema.allocationExceptions).get();
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
  it("matches a multi-line order by any of its SKUs", () => {
    const multi = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }, { productId: w.product2Id, quantity: 1 }], { skipAddressVerification: true }));
    const single = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }], { skipAddressVerification: true }));
    const codes = (params: string) => {
      const { where } = compileOrderGrid(parseGridQuery(new URLSearchParams(params)).query);
      return w.db.select({ code: schema.shipmentOrders.code }).from(schema.shipmentOrders).where(where).all().map((r) => r.code).sort();
    };
    expect(codes("f.sku=eq:MLT-WIDGET-01")).toEqual([multi.code, single.code].sort());
    expect(codes("f.sku=eq:MLT-GADGET-02")).toEqual([multi.code]);
    expect(codes("f.sku=nin:MLT-GADGET-02")).toEqual([single.code]);
  });
});
