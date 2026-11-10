/**
 * M02 acceptance flows against an in-memory migrated DB: label → Carrier Shipment Details +
 * EOD manifest, void, close EOD (PDF, new manifest after close), shipment plan create →
 * status popover options → Ship, plan orders/LPs, and Shipment History vs the ledger.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { allocateOrders } from "@/server/domain/allocation";
import { createJobsFromOrders } from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { createLabel } from "@/server/domain/shipping";
import { execute } from "@/server/domain/tasks";
import { EMPTY_GRID_QUERY, type GridQuery } from "@/server/query/grid-query";
import { closeManifests, listEndOfDay, printCustomReport, reprintManifests } from "@/server/repositories/end-of-day";
import { getShipment, listShipments, reprintShipments, voidShipments } from "@/server/repositories/shipping";
import { listShipmentHistory } from "@/server/repositories/shipping-history";
import { changePlanStatus, createPlan, deletePlans, estimateTotals, shipPlans, updatePlan } from "@/server/repositories/shipment-plans";
import { getPlanDetail, listEligibleOrders, listPlanOrders, listPlans } from "@/server/repositories/shipment-plans-lists";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const pkg = { weightOz: 20, length: 10, width: 8, height: 4 };
const q = (extra: Partial<GridQuery> = {}): GridQuery => ({ ...EMPTY_GRID_QUERY, ...extra });

function packedOrder(qty = 2): string {
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty });
  const o = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }]));
  allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
  const { jobIds: [jobId] } = createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
  const tasks = w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId)).all();
  execute(w.db, w.ctx, { taskIds: tasks.filter((t) => t.taskType === "Picking").map((t) => t.id), targetLocationId: w.loc.pick });
  execute(w.db, w.ctx, { taskIds: tasks.filter((t) => t.taskType === "Packing").map((t) => t.id), targetLocationId: w.loc.pack });
  return o.id;
}

const label = (orderId: string, packages = [pkg]) =>
  createLabel(w.db, w.ctx, { orderId, carrierConnectionId: w.carrierConnectionId, carrierServiceId: w.serviceIds.ground, packages }, { files: w.files });
const eodRows = () => listEndOfDay(w.db, auth, q({ pageSize: 100 })).rows;
const orderStatus = (id: string) => w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).get()?.status;

describe("label → Carrier Shipment Details → End Of The Day", () => {
  it("lists new labels and counts them on the open manifest; void lowers the count", async () => {
    const a = packedOrder();
    const b = packedOrder();
    const la = await label(a);
    expect(listShipments(w.db, auth, q()).total).toBe(1);
    expect(eodRows()).toHaveLength(1);
    expect(eodRows()[0]).toMatchObject({ status: "Open", totalPackages: 1, carrierPrefix: "SBX", isPending: true });
    await label(b, [pkg, pkg]);
    const rows = listShipments(w.db, auth, q()).rows;
    expect(rows).toHaveLength(3);
    const multi = rows.filter((r) => r.orderId === b);
    expect(multi.filter((r) => r.isMaster)).toHaveLength(1);
    expect(eodRows()[0]?.totalPackages).toBe(3);

    const id = la.shipments[0]?.id as string;
    const voided = await voidShipments(w.db, auth, w.ctx, [id]);
    expect(voided).toEqual({ succeeded: [id], failed: [] });
    const detail = getShipment(w.db, auth, id);
    expect(detail.labelStatus).toBe("Voided");
    expect(detail.voidedAt).toBeTruthy();
    expect(detail.voidBlockedReason).toMatch(/already voided/);
    expect(eodRows()[0]?.totalPackages).toBe(2);
    const again = await voidShipments(w.db, auth, w.ctx, [id]);
    expect(again.failed[0]?.code).toBe("INVALID_STATE");
    await expect(reprintShipments(w.db, auth, w.ctx, [id], w.files)).rejects.toThrow(/voided/);
  });

  it("drops a pending manifest once every label in it is voided", async () => {
    const la = await label(packedOrder());
    expect(eodRows()).toHaveLength(1);
    await voidShipments(w.db, auth, w.ctx, [la.shipments[0]?.id as string]);
    expect(eodRows()).toHaveLength(0);
  });

  it("filters by label status and quick search", async () => {
    const a = packedOrder();
    const r = await label(a);
    const tracking = r.shipments[0]?.trackingNumber as string;
    expect(listShipments(w.db, auth, q({ q: tracking, qm: "eq" })).total).toBe(1);
    expect(listShipments(w.db, auth, q({ filters: [{ field: "labelStatus", op: "in", values: ["Voided"] }] })).total).toBe(0);
    expect(listShipments(w.db, auth, q({ filters: [{ field: "labelCreatedAt", op: "date", date: { kind: "fixed", preset: "last30d" } }] })).total).toBe(1);
  });

  it("closes the manifest with a PDF; a later label opens a new manifest; reprint and custom report work", async () => {
    const a = packedOrder();
    await label(a);
    const open = eodRows()[0];
    if (!open) throw new Error("no manifest");
    const res = await closeManifests(w.db, auth, w.ctx, [open.id], w.files);
    expect(res.succeeded).toEqual([open.id]);
    expect(res.fileId).toBeTruthy();
    const closed = eodRows().find((r) => r.status === "Closed");
    expect(closed).toMatchObject({ isPrinted: true, totalPackages: 1 });
    expect(closed?.closeDate).toBeTruthy();
    const pdf = w.files.read(w.db, res.fileId as string);
    expect(pdf.record.mime).toBe("application/pdf");

    const again = await closeManifests(w.db, auth, w.ctx, [closed?.id as string], w.files);
    expect(again.failed[0]?.message).toMatch(/already closed/);

    await label(packedOrder());
    const rows = eodRows();
    expect(rows.filter((r) => r.status === "Open")).toHaveLength(1);
    expect(rows.find((r) => r.status === "Open")?.totalPackages).toBe(1);

    expect((await reprintManifests(w.db, auth, [closed?.id as string], w.files)).fileId).toBeTruthy();
    await expect(reprintManifests(w.db, auth, [rows.find((r) => r.status === "Open")?.id as string], w.files)).rejects.toThrow(/still open/);
    expect((await printCustomReport(w.db, auth, rows.map((r) => r.id), w.files)).succeeded).toHaveLength(2);
  });
});

describe("shipment plan KS-E2E-SP-1", () => {
  const base = (orderIds: string[]) => ({
    code: "KS-E2E-SP-1", warehouseId: w.warehouseId, clientId: null, carrierConnectionId: w.carrierConnectionId, truckPlateNumber: "KS 1001",
    loadingGateLocationId: w.loc.ship, status: "Open" as const, plannedShipmentAt: new Date().toISOString(), actualShipmentAt: null, loadingStartedAt: null,
    loadingCompletedAt: null, truckDepartedAt: null, expectedTotalVolume: 0, expectedTotalWeight: 0, preventLpnEditDuringLoading: false, note: null,
    customerId: null, customerAddressId: null, retailerId: null, customFields: {}, orderIds,
  });

  it("creates with 2 orders, offers legal statuses only, ships both and reflects it everywhere", async () => {
    const a = packedOrder();
    const b = packedOrder(3);
    expect(listEligibleOrders(w.db, auth, q(), { warehouseId: w.warehouseId }).total).toBe(2);
    const plan = createPlan(w.db, auth, w.ctx, base([a, b]));
    expect(plan).toMatchObject({ code: "KS-E2E-SP-1", status: "Open", orderCount: 2 });
    expect(plan.nextStatuses).toEqual(expect.arrayContaining(["In Progress", "Cancelled"]));
    expect(plan.nextStatuses).not.toContain("Open");
    expect(listEligibleOrders(w.db, auth, q(), { warehouseId: w.warehouseId }).total).toBe(0);
    expect(() => createPlan(w.db, auth, w.ctx, { ...base([a]), code: "KS-E2E-SP-2" })).toThrow(/already in plan/);
    expect(() => changePlanStatus(w.db, auth, w.ctx, plan.id, "Loading Completed", plan.version)).toThrow();
    expect(() => changePlanStatus(w.db, auth, w.ctx, plan.id, "Shipped", plan.version)).toThrow(/Use Ship/);

    const est = estimateTotals(w.db, auth, [a, b]);
    expect(est).toMatchObject({ weightLb: 2.5, units: 5, orders: 2 });

    const res = shipPlans(w.db, auth, w.ctx, [plan.id]);
    expect(res.succeeded).toEqual([plan.id]);
    expect(orderStatus(a)).toBe("Shipped");
    expect(orderStatus(b)).toBe("Shipped");
    const after = listPlans(w.db, auth, q()).rows[0];
    expect(after?.status).toBe("Shipped");
    expect(after?.actualShipmentAt).toBeTruthy();
    expect(after?.shipBlockedReason).toMatch(/already shipped/);
    const orders = listPlanOrders(w.db, auth, q()).rows;
    expect(orders.map((o) => o.planStatus)).toEqual(["Shipped", "Shipped"]);
    expect(orders.map((o) => o.orderStatus)).toEqual(["Shipped", "Shipped"]);
    const detail = getPlanDetail(w.db, auth, plan.id);
    expect(detail.timeline.length).toBeGreaterThan(0);
    expect(deletePlans(w.db, auth, w.ctx, [plan.id]).failed[0]?.message).toMatch(/Only Open/);
  });

  it("reports partial ship results and keeps the plan open", () => {
    const ready = packedOrder();
    const open = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.product2Id, quantity: 1 }])).id;
    const plan = createPlan(w.db, auth, w.ctx, base([ready, open]));
    const res = shipPlans(w.db, auth, w.ctx, [plan.id]);
    expect(res.failed[0]?.code).toBe("PARTIAL");
    expect(res.outcomes[0]?.shipped).toHaveLength(1);
    expect(listPlans(w.db, auth, q()).rows[0]?.status).toBe("Loading Started");
  });

  it("edits with optimistic concurrency and writes a change log", () => {
    const plan = createPlan(w.db, auth, w.ctx, base([]));
    const updated = updatePlan(w.db, auth, w.ctx, plan.id, { ...base([]), truckPlateNumber: "KS 2002", version: plan.version });
    expect(updated.truckPlateNumber).toBe("KS 2002");
    expect(() => updatePlan(w.db, auth, w.ctx, plan.id, { ...base([]), version: plan.version })).toThrow();
    const log = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, plan.id)).all();
    expect(log.some((l) => JSON.stringify(l).includes("KS 2002"))).toBe(true);
    expect(deletePlans(w.db, auth, w.ctx, [plan.id]).succeeded).toEqual([plan.id]);
  });
});

describe("Shipment History", () => {
  it("has one row per shipped ledger line with quantities equal to the ledger", async () => {
    const a = packedOrder(4);
    await label(a);
    const plan = createPlan(w.db, auth, w.ctx, {
      code: "KS-E2E-SP-H", warehouseId: w.warehouseId, clientId: null, carrierConnectionId: null, truckPlateNumber: null, loadingGateLocationId: null,
      status: "Open", plannedShipmentAt: null, actualShipmentAt: null, loadingStartedAt: null, loadingCompletedAt: null, truckDepartedAt: null,
      expectedTotalVolume: 0, expectedTotalWeight: 0, preventLpnEditDuringLoading: false, note: null, customerId: null, customerAddressId: null,
      retailerId: null, customFields: {}, orderIds: [a],
    });
    shipPlans(w.db, auth, w.ctx, [plan.id]);
    const history = listShipmentHistory(w.db, auth, q({ filters: [{ field: "shipmentType", op: "in", values: ["Shipment Order"] }] })).rows;
    const ledgerQty = w.db.select().from(schema.inventoryTransactions).where(eq(schema.inventoryTransactions.type, "Shipment")).all().reduce((s, t) => s + Math.abs(t.uomQty), 0);
    expect(history.reduce((s, r) => s + r.quantity, 0)).toBe(ledgerQty);
    expect(ledgerQty).toBe(4);
  });
});
