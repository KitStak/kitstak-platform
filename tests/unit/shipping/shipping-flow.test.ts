/**
 * M02 acceptance flows against an in-memory migrated DB: label → Carrier Shipment Details +
 * EOD manifest, void, close EOD (PDF, new manifest after close), shipment plan create →
 * status popover options → Ship, plan orders/LPs, and Shipment History vs the ledger.
 */
import { eq, sql } from "drizzle-orm";
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
import { getShipment, listShipments, reprintShipments, previewVoid, voidShipments } from "@/server/repositories/shipping";
import { listShipmentHistory } from "@/server/repositories/shipping-history";
import { changePlanStatus, createPlan, deletePlans, estimateTotals, planJobOrders, quickUpdatePlan, shipPlans, updatePlan } from "@/server/repositories/shipment-plans";
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
    expect(eodRows()[0]).toMatchObject({ status: "Open", totalPackages: 1, carrierPrefix: "SBX", isPending: false });
    await label(b, [pkg, pkg]);
    const rows = listShipments(w.db, auth, q()).rows;
    expect(rows).toHaveLength(3);
    const multi = rows.filter((r) => r.orderId === b);
    expect(multi.filter((r) => r.isMaster)).toHaveLength(1);
    expect(eodRows()[0]?.totalPackages).toBe(3);

    const id = la.shipments[0]?.id as string;
    const voided = await voidShipments(w.db, auth, w.ctx, [id]);
    expect(voided).toEqual({ succeeded: [id], failed: [], labelsVoided: 1, shipmentsVoided: 1 });
    const detail = getShipment(w.db, auth, id);
    expect(detail.labelStatus).toBe("Voided");
    expect(detail.voidedAt).toBeTruthy();
    expect(detail.voidBlockedReason).toMatch(/already voided/);
    expect(eodRows()[0]?.totalPackages).toBe(2);
    const again = await voidShipments(w.db, auth, w.ctx, [id]);
    expect(again.failed[0]?.code).toBe("INVALID_STATE");
    await expect(reprintShipments(w.db, auth, w.ctx, [id], w.files)).rejects.toThrow(/voided/);

    // Multi-package: selecting one package previews and voids both, and the count says so.
    const first = multi[0]?.id as string;
    const preview = previewVoid(w.db, auth, [first]);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows.filter((r) => r.selected).map((r) => r.id)).toEqual([first]);
    expect(preview).toMatchObject({ labelCount: 2, shipmentCount: 1 });
    const both = await voidShipments(w.db, auth, w.ctx, [first]);
    expect(both).toMatchObject({ succeeded: [first], failed: [], labelsVoided: 2, shipmentsVoided: 1 });
    expect(listShipments(w.db, auth, q()).rows.filter((r) => r.orderId === b).every((r) => r.labelStatus === "Voided")).toBe(true);
  });

  it("drops a pending manifest once every label in it is voided", async () => {
    const la = await label(packedOrder());
    expect(eodRows()).toHaveLength(1);
    await voidShipments(w.db, auth, w.ctx, [la.shipments[0]?.id as string]);
    expect(eodRows()).toHaveLength(0);
  });

  it("EOD Total package drill-down matches the manifest's warehouse-local ship date", async () => {
    await label(packedOrder(), [pkg, pkg]);
    const row = eodRows()[0];
    expect(row?.totalPackages).toBe(2);
    const day = row?.shipDate as string;
    const drill = (d: string) => listShipments(w.db, auth, q({ filters: [
      { field: "manifestShipDate", op: "date", date: { kind: "custom", from: d, to: d } },
      { field: "carrierPrefix", op: "in", values: [row?.carrierPrefix as string] },
    ] })).total;
    expect(drill(day)).toBe(2);
    expect(drill("2000-01-01")).toBe(0);
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

  it("keeps one carrier per manifest when a carrier setup ships with two carriers", async () => {
    const ups = (await label(packedOrder())).shipments[0];
    const usps = (await label(packedOrder())).shipments[0];
    if (!ups || !usps) throw new Error("no labels");
    // Same carrier setup, but this label went out on a USPS service.
    w.db.update(schema.shipments).set({ carrierCode: "USPS" }).where(eq(schema.shipments.id, usps.id)).run();
    const upsCode = w.db.select().from(schema.shipments).where(eq(schema.shipments.id, ups.id)).get()?.carrierCode as string;
    let rows = eodRows();
    expect(rows.map((r) => [r.carrierCode, r.totalPackages]).sort()).toEqual([[upsCode, 1], ["USPS", 1]].sort());

    const upsRow = rows.find((r) => r.carrierCode === upsCode);
    const res = await closeManifests(w.db, auth, w.ctx, [upsRow?.id as string], w.files);
    expect(res.failed).toEqual([]);
    rows = eodRows();
    expect(rows.find((r) => r.carrierCode === upsCode)).toMatchObject({ status: "Closed", totalPackages: 1 });
    // The USPS package was moved off the UPS manifest and still waits for its own close.
    expect(rows.find((r) => r.carrierCode === "USPS")).toMatchObject({ status: "Open", totalPackages: 1 });
    expect(w.db.select().from(schema.shipments).where(eq(schema.shipments.id, usps.id)).get()?.endOfDayManifestId).not.toBe(upsRow?.manifestId);

    const uspsClose = await closeManifests(w.db, auth, w.ctx, [rows.find((r) => r.carrierCode === "USPS")?.id as string], w.files);
    expect(uspsClose.failed).toEqual([]);
    rows = eodRows();
    expect(rows.filter((r) => r.status === "Closed").map((r) => r.carrierCode).sort()).toEqual([upsCode, "USPS"].sort());
    expect(new Set(rows.map((r) => r.manifestId)).size).toBe(2);
  });

  it("shows another carrier's labels on a closed manifest as their own closed row", async () => {
    const ups = (await label(packedOrder())).shipments[0];
    const usps = (await label(packedOrder())).shipments[0];
    if (!ups || !usps) throw new Error("no labels");
    const open = eodRows()[0];
    await closeManifests(w.db, auth, w.ctx, [open?.id as string], w.files);
    // Legacy data: a USPS label that was already closed on the UPS manifest.
    w.db.update(schema.shipments).set({ carrierCode: "USPS" }).where(eq(schema.shipments.id, usps.id)).run();
    const rows = eodRows();
    expect(rows).toHaveLength(2);
    const split = rows.find((r) => r.carrierCode === "USPS");
    expect(split).toMatchObject({ status: "Closed", totalPackages: 1, manifestId: open?.manifestId });
    expect(rows.find((r) => r.carrierCode !== "USPS")?.totalPackages).toBe(1);
    expect((await reprintManifests(w.db, auth, [split?.id as string], w.files)).fileId).toBeTruthy();
    expect((await closeManifests(w.db, auth, w.ctx, [split?.id as string], w.files)).failed[0]?.message).toMatch(/already closed/);
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

    await label(a);
    await label(b);
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

  it("warns when an order ships with a label already on a closed manifest", async () => {
    const a = packedOrder();
    const b = packedOrder();
    await label(a);
    const open = eodRows()[0];
    await closeManifests(w.db, auth, w.ctx, [open?.id as string], w.files);
    await label(b);
    const plan = createPlan(w.db, auth, w.ctx, base([a, b]));
    const outcome = shipPlans(w.db, auth, w.ctx, [plan.id]).outcomes[0];
    expect(outcome?.shipped).toHaveLength(2);
    expect(outcome?.manifestWarnings).toHaveLength(1);
    expect(outcome?.manifestWarnings[0]).toMatch(/already closed .*Reprint that manifest/);
    // The detail page reads one source for line totals: same as the estimate.
    const detail = getPlanDetail(w.db, auth, plan.id);
    const est = estimateTotals(w.db, auth, [a, b]);
    expect([detail.orderWeightLb, detail.orderVolumeFt3]).toEqual([est.weightLb, est.volumeFt3]);
  });

  it("reports partial ship results and keeps the plan open", async () => {
    const ready = packedOrder();
    await label(ready);
    const open = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.product2Id, quantity: 1 }])).id;
    const plan = createPlan(w.db, auth, w.ctx, base([ready, open]));
    const res = shipPlans(w.db, auth, w.ctx, [plan.id]);
    expect(res.failed[0]?.code).toBe("PARTIAL");
    expect(res.outcomes[0]?.shipped).toHaveLength(1);
    // Round 5: a partial ship leaves the status alone and invents no loading time (Logiwa parity).
    const row = listPlans(w.db, auth, q()).rows[0];
    expect(row?.status).toBe("Open");
    expect(row?.loadingStartedAt ?? null).toBeNull();
    expect(res.outcomes[0]?.planStatus).toBe("Open");
    expect(res.outcomes[0]?.statusNote).toBe("Plan status stays Open: 1 of 2 orders shipped. It becomes Shipped when the rest ship.");
    const log = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, plan.id)).all();
    expect(log.some((r) => r.field === "status" || r.field === "loadingStartedAt")).toBe(false);
  });

  it("stores readable change-log sentences (orders, status, zone-formatted times)", async () => {
    const a = packedOrder();
    await label(a);
    const plan = createPlan(w.db, auth, w.ctx, base([a]));
    shipPlans(w.db, auth, w.ctx, [plan.id]);
    const msgs = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, plan.id)).all().map((r) => r.message);
    expect(msgs.some((m) => /^Added order SO\S+\.$/.test(m))).toBe(true);
    expect(msgs).toContain("Status changed from Open to Shipped.");
    for (const m of msgs) {
      expect(m).not.toMatch(/is modified|-->|\s{2}|\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("rejects a malformed create at the domain layer with VALIDATION, never a DB error", () => {
    const bad = { ...base([]), code: "   ", expectedTotalVolume: undefined, expectedTotalWeight: undefined } as unknown as Parameters<typeof createPlan>[3];
    const made = createPlan(w.db, auth, w.ctx, bad);
    expect(made.code).toMatch(/\S/);
    expect(Number(made.expectedTotalVolume)).toBe(0);
    let err: unknown;
    try { createPlan(w.db, auth, w.ctx, { ...base([]), warehouseId: "" } as Parameters<typeof createPlan>[3]); } catch (e) { err = e; }
    expect((err as { code?: string }).code).toBe("VALIDATION");
    expect((err as { fieldErrors?: Record<string, string[]> }).fieldErrors?.warehouseId?.length).toBeGreaterThan(0);
  });

  it("never ships an order without an active label (all labels voided) and says why", async () => {
    const labelled = packedOrder();
    const voidedOnly = packedOrder();
    await label(labelled);
    const v = await label(voidedOnly);
    await voidShipments(w.db, auth, w.ctx, [v.shipments[0]?.id as string]);
    const plan = createPlan(w.db, auth, w.ctx, base([labelled, voidedOnly]));
    const row = listPlans(w.db, auth, q()).rows[0];
    expect(row?.unlabeledReadyCount).toBe(1);
    expect(row?.shipBlockedReason).toBeNull();
    const outcome = shipPlans(w.db, auth, w.ctx, [plan.id]).outcomes[0];
    expect(outcome?.shipped).toHaveLength(1);
    expect(outcome?.failed[0]?.message).toMatch(/no active shipping label: its label was voided/);
    expect(orderStatus(voidedOnly)).toBe("Ready to Ship");
    // db:verify shipped_without_label stays green.
    const bad = w.db.all<{ id: string }>(sql`SELECT o.id FROM shipment_orders o WHERE o.status IN ('Shipped','Delivered','Partially Shipped')
      AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.label_type = 'Shipping Label' AND s.label_status = 'Active')`);
    expect(bad).toEqual([]);
  });

  it("blocks Ship when no Ready to Ship order has a label; ship stamps only the actual shipment time", async () => {
    const a = packedOrder();
    const plan = createPlan(w.db, auth, w.ctx, base([a]));
    expect(listPlans(w.db, auth, q()).rows[0]?.shipBlockedReason).toMatch(/has no active shipping label/);
    expect(shipPlans(w.db, auth, w.ctx, [plan.id]).failed[0]?.message).toMatch(/has no active shipping label\. Create a shipping label first/);
    expect(orderStatus(a)).toBe("Ready to Ship");
    await label(a);
    shipPlans(w.db, auth, w.ctx, [plan.id]);
    const after = getPlanDetail(w.db, auth, plan.id);
    expect(after.status).toBe("Shipped");
    expect(after.actualShipmentAt).toBeTruthy();
    expect([after.loadingStartedAt, after.loadingCompletedAt, after.truckDepartedAt]).toEqual([null, null, null]);
  });

  it("lists the plan's unshipped orders for Picking/Job Operations and derives the consignee from orders", () => {
    const a = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.product2Id, quantity: 1 }])).id;
    const plan = createPlan(w.db, auth, w.ctx, base([a]));
    expect(planJobOrders(w.db, auth, [plan.id])).toMatchObject({ orderIds: [a], plans: [{ id: plan.id, orderCount: 1 }] });
    const row = listPlans(w.db, auth, q()).rows[0];
    const detail = getPlanDetail(w.db, auth, plan.id);
    expect(row?.customerName).toBe(detail.customerName);
    expect(row?.customerName).toBeTruthy();
    expect(row?.customerNameHint).toBe("from orders");
    expect(listPlans(w.db, auth, q({ filters: [{ field: "customerName", op: "ct", value: String(row?.customerName).slice(0, 3) }] })).total).toBe(1);
  });

  it("blocks loading while an order isn't Ready to Ship, and hides a stray actual date", () => {
    const open = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.product2Id, quantity: 1 }])).id;
    const plan = createPlan(w.db, auth, w.ctx, base([open]));
    const prog = changePlanStatus(w.db, auth, w.ctx, plan.id, "In Progress", plan.version);
    expect(prog.statusBlocks["Loading Started"]).toMatch(/1 of 1 orders/);
    expect(() => changePlanStatus(w.db, auth, w.ctx, plan.id, "Loading Started", prog.version)).toThrow(/Ready to Ship/);
    w.db.update(schema.shipmentPlans).set({ actualShipmentAt: "2026-01-01T00:00:00Z" }).where(eq(schema.shipmentPlans.id, plan.id)).run();
    expect(listPlans(w.db, auth, q()).rows[0]?.actualShipmentAt).toBeNull();
    expect(getPlanDetail(w.db, auth, plan.id).actualShipmentAt).toBeNull();
  });

  it("edits inline fields with the row version", () => {
    const plan = createPlan(w.db, auth, w.ctx, base([]));
    const updated = quickUpdatePlan(w.db, auth, w.ctx, plan.id, { version: plan.version, truckPlateNumber: "KS 7001" });
    expect(updated.truckPlateNumber).toBe("KS 7001");
    expect(() => quickUpdatePlan(w.db, auth, w.ctx, plan.id, { version: updated.version, loadingStartedAt: new Date().toISOString() })).toThrow(/Loading Started/);
    expect(() => quickUpdatePlan(w.db, auth, w.ctx, plan.id, { version: plan.version, truckPlateNumber: "X" })).toThrow();
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
