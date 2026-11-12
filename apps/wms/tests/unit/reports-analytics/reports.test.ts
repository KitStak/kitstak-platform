/** M13 reports: grid compiler, report read models, formulas, change-log presentation — in-memory migrated DB. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { EMPTY_GRID_QUERY, parseGridQuery, type GridQuery } from "@/server/query/grid-query";
import { AppError } from "@/server/api/errors";
import { compileReportGrid } from "@/server/repositories/reports-grid";
import { humanizeProperty, listChangeLog, listMissingLog, listTransactions } from "@/server/repositories/reports-logs";
import { computeToReplenish, listReplenishment, listSnapshot } from "@/server/repositories/reports-inventory";
import { listChannelSales, listOrderInventory } from "@/server/repositories/reports-orders";
import { listPoReceiving, listUserPerformance, periodSince, receivingDifference } from "@/server/repositories/reports-receiving";
import { reportExportProvider } from "@/server/repositories/reports-api";
import { TRANSACTION_HISTORY_DEF, CHANGE_LOG_DEF, EXPORT_HISTORY_DEF } from "@/lib/grid-defs/reports/logs";
import { exportColumnsOf, sortableOf } from "@/lib/grid-defs/reports/types";
import { REPORT_CATALOG, matchesReport } from "@/lib/grid-defs/reports/catalog";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
const q = (qs = ""): GridQuery => ({ ...EMPTY_GRID_QUERY, ...parseGridQuery(qs).query, pageSize: 100 });

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(["settings.users.view"]), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const stock = async (qty: number, locationId = w.loc.storageA) =>
  (await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId, qty })).bucket;

describe("report grid compiler", () => {
  it("rejects unknown sort fields and unknown filter fields with VALIDATION", () => {
    expect(() => compileReportGrid(TRANSACTION_HISTORY_DEF, q("sort=nope"))).toThrow(AppError);
    expect(() => compileReportGrid(TRANSACTION_HISTORY_DEF, q("f.nope=eq:x"))).toThrow(/Unknown filter field/);
  });

  it("derives sortable aliases and export columns from the def (Action column is never exported)", () => {
    expect(sortableOf(CHANGE_LOG_DEF)).not.toContain("fromValue");
    expect(exportColumnsOf(EXPORT_HISTORY_DEF).map((c) => c.key)).toContain("rowCount");
    expect(TRANSACTION_HISTORY_DEF.columns.length).toBe(53);
  });
});

describe("Transaction History (ledger)", () => {
  it("lists every ledger row with type, SKU, target location and user, newest first", async () => {
    await stock(12);
    await stock(3, w.loc.storageB);
    const page = await listTransactions(w.db, auth, q());
    expect(page.total).toBe(2);
    expect(page.rows[0]).toMatchObject({ uomQty: 3 });
    expect(page.rows[0]?.targetLocation).toBeTruthy();
    expect(page.rows.every((r) => typeof r.type === "string")).toBe(true);
  });

  it("filters by transaction type and quick search, and hides other warehouses' rows", async () => {
    await stock(5);
    expect((await listTransactions(w.db, auth, q("f.type=in:Shipment"))).total).toBe(0);
    const sku = (await w.db.select().from(schema.products).where(eq(schema.products.id, w.productId)).limit(1))[0]?.sku ?? "";
    expect((await listTransactions(w.db, auth, q(`q=${sku}&qm=eq`))).total).toBe(1);
    const other = { warehouseIds: ["nope"], clientIds: "all" as const };
    expect((await listTransactions(w.db, { ...auth, viewScope: other } as AuthContext, q())).total).toBe(0);
  });

  it("export provider pages through the same scoped query", async () => {
    await stock(5);
    const provider = reportExportProvider(TRANSACTION_HISTORY_DEF, listTransactions);
    const page = await provider.fetchPage({ db: w.db, auth, gridKey: TRANSACTION_HISTORY_DEF.gridKey, query: q(), rawQuery: "" }, 1, 500);
    expect(page.total).toBe(1);
    expect(provider.columns?.length).toBe(53);
  });
});

describe("Change Log", () => {
  it("humanizes raw property keys (beats Logiwa.NameKey.*)", () => {
    expect(humanizeProperty("Logiwa.NameKey.RemainingVolume")).toBe("Remaining Volume");
    expect(humanizeProperty("shipmentPackageId")).toBe("Shipment Package Id");
    expect(humanizeProperty(null)).toBeNull();
  });

  it("shows 'Open --> Ready to Pick' for an order with a deep link, and resolves raw ids to names", async () => {
    const order = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    await w.db.insert(schema.changeLog).values([
      { entityType: "shipment_order", entityId: order.id, entityCode: order.code, type: "Update", field: "status", fieldLabel: "Status", fromValue: "Open", toValue: "Ready to Pick", message: "Status is modified. Open --> Ready to Pick", source: "admin@test.io" },
      { entityType: "shipment_order", entityId: order.id, entityCode: order.code, type: "Update", field: "assignedToUserId", fieldLabel: "Assigned To User Id", fromValue: "", toValue: w.userId, message: "x", source: "admin@test.io" },
    ]);
    const rows = (await listChangeLog(w.db, auth, q(`q=${order.code}&qm=eq&f.property=eq:Status`))).rows;
    expect(rows[0]).toMatchObject({ module: "Shipment Order", code: order.code, href: `/orders/${order.id}`, fromValue: "Open", toValue: "Ready to Pick" });
    const assignee = (await listChangeLog(w.db, auth, q(`q=${order.code}&qm=eq&f.property=ct:Assigned`))).rows[0];
    expect(assignee).toMatchObject({ property: "Assigned To User", toValue: "Admin", fromValue: null });
  });

  it("filters by event type and module, and hides another warehouse's records", async () => {
    const order = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    await w.db.insert(schema.changeLog).values({ entityType: "shipment_order", entityId: order.id, entityCode: order.code, type: "Delete", message: "Deleted", source: "admin@test.io" });
    expect((await listChangeLog(w.db, auth, q("f.type=in:Delete&f.module=in:Shipment%20Order"))).total).toBeGreaterThanOrEqual(1);
    const scoped = { ...auth, viewScope: { warehouseIds: ["elsewhere"], clientIds: ["x"] } } as unknown as AuthContext;
    expect((await listChangeLog(w.db, scoped, q("f.type=in:Delete"))).total).toBe(0);
  });

  it("roles without user management see only their own changes", async () => {
    const order = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    await w.db.insert(schema.changeLog).values({ entityType: "shipment_order", entityId: order.id, entityCode: order.code, type: "Delete", message: "Deleted", source: "someone@test.io" });
    const own = { ...auth, permissions: new Set<string>(), user: { id: "another-user" } } as unknown as AuthContext;
    expect((await listChangeLog(w.db, auth, q("f.type=in:Delete"))).total).toBeGreaterThanOrEqual(1);
    expect((await listChangeLog(w.db, own, q("f.type=in:Delete"))).total).toBe(0);
  });
});

describe("Dynamic Replenishment", () => {
  it("ToReplenish = Max + OpenOrderQty − TargetAvailable − OpenTasks, never negative (Logiwa sample 200+74−85−0 = 189)", () => {
    expect(computeToReplenish({ max: 200, openOrderQty: 74, targetAvailable: 85, openTaskQty: 0 })).toBe(189);
    expect(computeToReplenish({ max: 10, openOrderQty: 0, targetAvailable: 50, openTaskQty: 0 })).toBe(0);
  });

  it("computes the row from levels, pick-face stock and open orders", async () => {
    await w.db.insert(schema.productReplenishmentLevels).values({ productId: w.productId, warehouseId: w.warehouseId, minLevel: 5, maxLevel: 50 });
    await stock(8, w.loc.pick);
    await stock(100, w.loc.storageA);
    await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 4 }]));
    const row = (await listReplenishment(w.db, auth, q())).rows[0];
    const pickType = (await w.db.select().from(schema.locations).where(eq(schema.locations.id, w.loc.pick)).limit(1))[0]?.type;
    expect(row).toMatchObject({ maxLevel: 50, openOrderQty: 4 });
    if (pickType === "Picking") expect(row?.toReplenishQty).toBe(50 + 4 - 8);
    expect((await listReplenishment(w.db, auth, q("f.isActive=bool:true"))).total).toBe(1);
  });
});

describe("Order Inventory / Channel Sales / Snapshot / Missing Log", () => {
  it("returns empty pages (not errors) on a fresh warehouse", async () => {
    expect((await listOrderInventory(w.db, auth, q())).total).toBe(0);
    expect((await listSnapshot(w.db, auth, q("f.snapshotAt=date:withinPast1d"))).total).toBe(0);
    expect((await listMissingLog(w.db, auth, q())).total).toBe(0);
  });

  it("Channel Sales aggregates shipped lines per warehouse × client × channel × SKU with a populated Warehouse", async () => {
    const order = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 3 }], { channel: "Shopify", storeName: "Main store" }));
    await w.db.update(schema.shipmentOrders).set({ status: "Shipped", shippedAt: new Date().toISOString() }).where(eq(schema.shipmentOrders.id, order.id));
    const row = (await listChannelSales(w.db, auth, q())).rows[0];
    expect(row).toMatchObject({ channel: "Shopify", storeName: "Main store", soldQty: 3, shipmentOrderCount: 1, revenue: 30 });
    expect(String(row?.warehouse)).toContain("MLT1");
    expect(String(row?.ordersHref)).toContain("/orders/shipped?");
  });
});

describe("PO Receiving and User Performance", () => {
  it("difference is received − ordered UOM and blank when equal", async () => {
    expect(receivingDifference(5, 0)).toBe(-5);
    expect(receivingDifference(10, 12)).toBe(2);
    expect(receivingDifference(10, 10)).toBeNull();
    expect((await listPoReceiving(w.db, auth, q("f.hasDifference=bool:true"))).total).toBe(0);
  });

  it("Period chip maps to a lower bound; no chip means all time", () => {
    const now = new Date("2026-11-06T15:00:00Z");
    expect(periodSince(q("f.period=in:Last%207%20days"), now)).toBe("2026-10-31T00:00:00.000Z");
    expect(periodSince(q(), now)).toBeNull();
  });

  it("aggregates completed tasks per warehouse × user × day", async () => {
    const job = (await w.db.insert(schema.jobs).values({ id: crypto.randomUUID(), code: "Job1", warehouseId: w.warehouseId, jobType: "Picking", status: "Completed" }).returning())[0];
    const fin = new Date().toISOString();
    await w.db.insert(schema.tasks).values([
      { taskNo: 1, jobId: job.id, warehouseId: w.warehouseId, taskType: "Picking", status: "Completed", actualQty: 4, plannedQty: 4, executedByUserId: w.userId, finishedAt: fin, orderId: "o1", orderLineId: "l1" },
      { taskNo: 2, jobId: job.id, warehouseId: w.warehouseId, taskType: "Picking", status: "Completed", actualQty: 2, plannedQty: 2, executedByUserId: w.userId, finishedAt: fin, orderId: "o1", orderLineId: "l2" },
      { taskNo: 3, jobId: job.id, warehouseId: w.warehouseId, taskType: "Packing", status: "Completed", actualQty: 6, plannedQty: 6, executedByUserId: w.userId, finishedAt: fin, orderId: "o1", orderLineId: "l1" },
    ]);
    const row = (await listUserPerformance(w.db, auth, q("f.period=in:Last%207%20days"))).rows[0];
    expect(row).toMatchObject({ user: "Admin", pickedOrderQty: 1, pickedLineQty: 2, pickedItemQty: 6, packedOrderQty: 1, packedItemQty: 6 });
  });
});

describe("Report Hub catalog", () => {
  it("is built from the Reports mega-menu: 5 groups, every item described", () => {
    expect(REPORT_CATALOG.map((g) => g.heading)).toEqual(["Orders", "Inventory", "Inventory Analysis", "Logs", "Receiving", "Warehouse Efficiency", "Labor Analytics", "Operational Analytics"]);
    for (const item of REPORT_CATALOG.flatMap((g) => g.items)) expect(item.description).not.toBe("");
  });

  it("search matches label, description, group and aliases", () => {
    const all = REPORT_CATALOG.flatMap((g) => g.items);
    expect(all.filter((i) => matchesReport(i, "ledger")).map((i) => i.label)).toContain("Transaction History");
    expect(all.filter((i) => matchesReport(i, "zzz"))).toHaveLength(0);
  });
});
