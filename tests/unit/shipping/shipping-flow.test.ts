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
import { dbAll } from "@/server/db/sql";

let w: World;
let auth: AuthContext;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const pkg = { weightOz: 20, length: 10, width: 8, height: 4 };
const q = (extra: Partial<GridQuery> = {}): GridQuery => ({ ...EMPTY_GRID_QUERY, ...extra });

async function packedOrder(qty = 2): Promise<string> {
  await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty });
  const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }]));
  await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
  const { jobIds: [jobId] } = await createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
  const tasks = await w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId));
  await execute(w.db, w.ctx, { taskIds: tasks.filter((t) => t.taskType === "Picking").map((t) => t.id), targetLocationId: w.loc.pick });
  await execute(w.db, w.ctx, { taskIds: tasks.filter((t) => t.taskType === "Packing").map((t) => t.id), targetLocationId: w.loc.pack });
  return o.id;
}

const label = (orderId: string, packages = [pkg]) =>
  createLabel(w.db, w.ctx, { orderId, carrierConnectionId: w.carrierConnectionId, carrierServiceId: w.serviceIds.ground, packages }, { files: w.files });
const eodRows = async () => (await listEndOfDay(w.db, auth, q({ pageSize: 100 }))).rows;
const orderStatus = async (id: string) => (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).limit(1))[0]?.status;

describe("label → Carrier Shipment Details → End Of The Day", () => {
  it("lists new labels and counts them on the open manifest; void lowers the count", async () => {
    const a = await packedOrder();
    const b = await packedOrder();
    const la = await label(a);
    expect((await listShipments(w.db, auth, q())).total).toBe(1);
    expect(await eodRows()).toHaveLength(1);
    expect((await eodRows())[0]).toMatchObject({ status: "Open", totalPackages: 1, carrierPrefix: "SBX", isPending: false });
    await label(b, [pkg, pkg]);
    const rows = (await listShipments(w.db, auth, q())).rows;
    expect(rows).toHaveLength(3);
    const multi = rows.filter((r) => r.orderId === b);
    expect(multi.filter((r) => r.isMaster)).toHaveLength(1);
    expect((await eodRows())[0]?.totalPackages).toBe(3);

    const id = la.shipments[0]?.id as string;
    const voided = await voidShipments(w.db, auth, w.ctx, [id]);
    expect(voided).toEqual({ succeeded: [id], failed: [], labelsVoided: 1, shipmentsVoided: 1 });
    const detail = await getShipment(w.db, auth, id);
    expect(detail.labelStatus).toBe("Voided");
    expect(detail.voidedAt).toBeTruthy();
    expect(detail.voidBlockedReason).toMatch(/already voided/);
    expect((await eodRows())[0]?.totalPackages).toBe(2);
    const again = await voidShipments(w.db, auth, w.ctx, [id]);
    expect(again.failed[0]?.code).toBe("INVALID_STATE");
    await expect(reprintShipments(w.db, auth, w.ctx, [id], w.files)).rejects.toThrow(/voided/);

    // Multi-package: selecting one package previews and voids both, and the count says so.
    const first = multi[0]?.id as string;
    const preview = await previewVoid(w.db, auth, [first]);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows.filter((r) => r.selected).map((r) => r.id)).toEqual([first]);
    expect(preview).toMatchObject({ labelCount: 2, shipmentCount: 1 });
    const both = await voidShipments(w.db, auth, w.ctx, [first]);
    expect(both).toMatchObject({ succeeded: [first], failed: [], labelsVoided: 2, shipmentsVoided: 1 });
    expect((await listShipments(w.db, auth, q())).rows.filter((r) => r.orderId === b).every((r) => r.labelStatus === "Voided")).toBe(true);
  });

  it("drops a pending manifest once every label in it is voided", async () => {
    const la = await label(await packedOrder());
    expect(await eodRows()).toHaveLength(1);
    await voidShipments(w.db, auth, w.ctx, [la.shipments[0]?.id as string]);
    expect(await eodRows()).toHaveLength(0);
  });

  it("EOD Total package drill-down matches the manifest's warehouse-local ship date", async () => {
    await label(await packedOrder(), [pkg, pkg]);
    const row = (await eodRows())[0];
    expect(row?.totalPackages).toBe(2);
    const day = row?.shipDate as string;
    const drill = async (d: string) => (await listShipments(w.db, auth, q({ filters: [
      { field: "manifestShipDate", op: "date", date: { kind: "custom", from: d, to: d } },
      { field: "carrierPrefix", op: "in", values: [row?.carrierPrefix as string] },
    ] }))).total;
    expect(await drill(day)).toBe(2);
    expect(await drill("2000-01-01")).toBe(0);
  });

  it("filters by label status and quick search", async () => {
    const a = await packedOrder();
    const r = await label(a);
    const tracking = r.shipments[0]?.trackingNumber as string;
    expect((await listShipments(w.db, auth, q({ q: tracking, qm: "eq" }))).total).toBe(1);
    expect((await listShipments(w.db, auth, q({ filters: [{ field: "labelStatus", op: "in", values: ["Voided"] }] }))).total).toBe(0);
    expect((await listShipments(w.db, auth, q({ filters: [{ field: "labelCreatedAt", op: "date", date: { kind: "fixed", preset: "last30d" } }] }))).total).toBe(1);
  });

  it("closes the manifest with a PDF; a later label opens a new manifest; reprint and custom report work", async () => {
    const a = await packedOrder();
    await label(a);
    const open = (await eodRows())[0];
    if (!open) throw new Error("no manifest");
    const res = await closeManifests(w.db, auth, w.ctx, [open.id], w.files);
    expect(res.succeeded).toEqual([open.id]);
    expect(res.fileId).toBeTruthy();
    const closed = (await eodRows()).find((r) => r.status === "Closed");
    expect(closed).toMatchObject({ isPrinted: true, totalPackages: 1 });
    expect(closed?.closeDate).toBeTruthy();
    const pdf = await w.files.read(w.db, res.fileId as string);
    expect(pdf.record.mime).toBe("application/pdf");

    const again = await closeManifests(w.db, auth, w.ctx, [closed?.id as string], w.files);
    expect(again.failed[0]?.message).toMatch(/already closed/);

    await label(await packedOrder());
    const rows = await eodRows();
    expect(rows.filter((r) => r.status === "Open")).toHaveLength(1);
    expect(rows.find((r) => r.status === "Open")?.totalPackages).toBe(1);

    expect((await reprintManifests(w.db, auth, [closed?.id as string], w.files)).fileId).toBeTruthy();
    await expect(reprintManifests(w.db, auth, [rows.find((r) => r.status === "Open")?.id as string], w.files)).rejects.toThrow(/still open/);
    expect((await printCustomReport(w.db, auth, rows.map((r) => r.id), w.files)).succeeded).toHaveLength(2);
  });

  it("keeps one carrier per manifest when a carrier setup ships with two carriers", async () => {
    const ups = (await label(await packedOrder())).shipments[0];
    const usps = (await label(await packedOrder())).shipments[0];
    if (!ups || !usps) throw new Error("no labels");
    // Same carrier setup, but this label went out on a USPS service.
    await w.db.update(schema.shipments).set({ carrierCode: "USPS" }).where(eq(schema.shipments.id, usps.id));
    const upsCode = (await w.db.select().from(schema.shipments).where(eq(schema.shipments.id, ups.id)).limit(1))[0]?.carrierCode as string;
    let rows = await eodRows();
    expect(rows.map((r) => [r.carrierCode, r.totalPackages]).sort()).toEqual([[upsCode, 1], ["USPS", 1]].sort());

    const upsRow = rows.find((r) => r.carrierCode === upsCode);
    const res = await closeManifests(w.db, auth, w.ctx, [upsRow?.id as string], w.files);
    expect(res.failed).toEqual([]);
    rows = await eodRows();
    expect(rows.find((r) => r.carrierCode === upsCode)).toMatchObject({ status: "Closed", totalPackages: 1 });
    // The USPS package was moved off the UPS manifest and still waits for its own close.
    expect(rows.find((r) => r.carrierCode === "USPS")).toMatchObject({ status: "Open", totalPackages: 1 });
    expect((await w.db.select().from(schema.shipments).where(eq(schema.shipments.id, usps.id)).limit(1))[0]?.endOfDayManifestId).not.toBe(upsRow?.manifestId);

    const uspsClose = await closeManifests(w.db, auth, w.ctx, [rows.find((r) => r.carrierCode === "USPS")?.id as string], w.files);
    expect(uspsClose.failed).toEqual([]);
    rows = await eodRows();
    expect(rows.filter((r) => r.status === "Closed").map((r) => r.carrierCode).sort()).toEqual([upsCode, "USPS"].sort());
    expect(new Set(rows.map((r) => r.manifestId)).size).toBe(2);
  });

  it("shows another carrier's labels on a closed manifest as their own closed row", async () => {
    const ups = (await label(await packedOrder())).shipments[0];
    const usps = (await label(await packedOrder())).shipments[0];
    if (!ups || !usps) throw new Error("no labels");
    const open = (await eodRows())[0];
    await closeManifests(w.db, auth, w.ctx, [open?.id as string], w.files);
    // Legacy data: a USPS label that was already closed on the UPS manifest.
    await w.db.update(schema.shipments).set({ carrierCode: "USPS" }).where(eq(schema.shipments.id, usps.id));
    const rows = await eodRows();
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
    const a = await packedOrder();
    const b = await packedOrder(3);
    expect((await listEligibleOrders(w.db, auth, q(), { warehouseId: w.warehouseId })).total).toBe(2);
    const plan = await createPlan(w.db, auth, w.ctx, base([a, b]));
    expect(plan).toMatchObject({ code: "KS-E2E-SP-1", status: "Open", orderCount: 2 });
    expect(plan.nextStatuses).toEqual(expect.arrayContaining(["In Progress", "Cancelled"]));
    expect(plan.nextStatuses).not.toContain("Open");
    expect((await listEligibleOrders(w.db, auth, q(), { warehouseId: w.warehouseId })).total).toBe(0);
    await expect(async () => await createPlan(w.db, auth, w.ctx, { ...base([a]), code: "KS-E2E-SP-2" })).rejects.toThrow(/already in plan/);
    await expect(async () => await changePlanStatus(w.db, auth, w.ctx, plan.id, "Loading Completed", plan.version)).rejects.toThrow();
    await expect(async () => await changePlanStatus(w.db, auth, w.ctx, plan.id, "Shipped", plan.version)).rejects.toThrow(/Use Ship/);

    const est = await estimateTotals(w.db, auth, [a, b]);
    expect(est).toMatchObject({ weightLb: 2.5, units: 5, orders: 2 });

    await label(a);
    await label(b);
    const res = await shipPlans(w.db, auth, w.ctx, [plan.id]);
    expect(res.succeeded).toEqual([plan.id]);
    expect(await orderStatus(a)).toBe("Shipped");
    expect(await orderStatus(b)).toBe("Shipped");
    const after = (await listPlans(w.db, auth, q())).rows[0];
    expect(after?.status).toBe("Shipped");
    expect(after?.actualShipmentAt).toBeTruthy();
    expect(after?.shipBlockedReason).toMatch(/already shipped/);
    const orders = (await listPlanOrders(w.db, auth, q())).rows;
    expect(orders.map((o) => o.planStatus)).toEqual(["Shipped", "Shipped"]);
    expect(orders.map((o) => o.orderStatus)).toEqual(["Shipped", "Shipped"]);
    const detail = await getPlanDetail(w.db, auth, plan.id);
    expect(detail.timeline.length).toBeGreaterThan(0);
    expect((await deletePlans(w.db, auth, w.ctx, [plan.id])).failed[0]?.message).toMatch(/Only Open/);
  });

  it("warns when an order ships with a label already on a closed manifest", async () => {
    const a = await packedOrder();
    const b = await packedOrder();
    await label(a);
    const open = (await eodRows())[0];
    await closeManifests(w.db, auth, w.ctx, [open?.id as string], w.files);
    await label(b);
    const plan = await createPlan(w.db, auth, w.ctx, base([a, b]));
    const outcome = (await shipPlans(w.db, auth, w.ctx, [plan.id])).outcomes[0];
    expect(outcome?.shipped).toHaveLength(2);
    expect(outcome?.manifestWarnings).toHaveLength(1);
    expect(outcome?.manifestWarnings[0]).toMatch(/already closed .*Reprint that manifest/);
    // The detail page reads one source for line totals: same as the estimate.
    const detail = await getPlanDetail(w.db, auth, plan.id);
    const est = await estimateTotals(w.db, auth, [a, b]);
    expect([detail.orderWeightLb, detail.orderVolumeFt3]).toEqual([est.weightLb, est.volumeFt3]);
  });

  it("reports partial ship results and keeps the plan open", async () => {
    const ready = await packedOrder();
    await label(ready);
    const open = (await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.product2Id, quantity: 1 }]))).id;
    const plan = await createPlan(w.db, auth, w.ctx, base([ready, open]));
    const res = await shipPlans(w.db, auth, w.ctx, [plan.id]);
    expect(res.failed[0]?.code).toBe("PARTIAL");
    expect(res.outcomes[0]?.shipped).toHaveLength(1);
    // Round 5: a partial ship leaves the status alone and invents no loading time (Logiwa parity).
    const row = (await listPlans(w.db, auth, q())).rows[0];
    expect(row?.status).toBe("Open");
    expect(row?.loadingStartedAt ?? null).toBeNull();
    expect(res.outcomes[0]?.planStatus).toBe("Open");
    expect(res.outcomes[0]?.statusNote).toBe("Plan status stays Open: 1 of 2 orders shipped. It becomes Shipped when the rest ship.");
    const log = await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, plan.id));
    expect(log.some((r) => r.field === "status" || r.field === "loadingStartedAt")).toBe(false);
  });

  it("stores readable change-log sentences (orders, status, zone-formatted times)", async () => {
    const a = await packedOrder();
    await label(a);
    const plan = await createPlan(w.db, auth, w.ctx, base([a]));
    await shipPlans(w.db, auth, w.ctx, [plan.id]);
    const msgs = (await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, plan.id))).map((r) => r.message);
    expect(msgs.some((m) => /^Added order SO\S+\.$/.test(m))).toBe(true);
    expect(msgs).toContain("Status changed from Open to Shipped.");
    for (const m of msgs) {
      expect(m).not.toMatch(/is modified|-->|\s{2}|\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("rejects a malformed create at the domain layer with VALIDATION, never a DB error", async () => {
    const bad = { ...base([]), code: "   ", expectedTotalVolume: undefined, expectedTotalWeight: undefined } as unknown as Parameters<typeof createPlan>[3];
    const made = await createPlan(w.db, auth, w.ctx, bad);
    expect(made.code).toMatch(/\S/);
    expect(Number(made.expectedTotalVolume)).toBe(0);
    let err: unknown;
    try { await createPlan(w.db, auth, w.ctx, { ...base([]), warehouseId: "" } as Parameters<typeof createPlan>[3]); } catch (e) { err = e; }
    expect((err as { code?: string }).code).toBe("VALIDATION");
    expect((err as { fieldErrors?: Record<string, string[]> }).fieldErrors?.warehouseId?.length).toBeGreaterThan(0);
  });

  it("never ships an order without an active label (all labels voided) and says why", async () => {
    const labelled = await packedOrder();
    const voidedOnly = await packedOrder();
    await label(labelled);
    const v = await label(voidedOnly);
    await voidShipments(w.db, auth, w.ctx, [v.shipments[0]?.id as string]);
    const plan = await createPlan(w.db, auth, w.ctx, base([labelled, voidedOnly]));
    const row = (await listPlans(w.db, auth, q())).rows[0];
    expect(row?.unlabeledReadyCount).toBe(1);
    expect(row?.shipBlockedReason).toBeNull();
    const outcome = (await shipPlans(w.db, auth, w.ctx, [plan.id])).outcomes[0];
    expect(outcome?.shipped).toHaveLength(1);
    expect(outcome?.failed[0]?.message).toMatch(/no active shipping label: its label was voided/);
    expect(await orderStatus(voidedOnly)).toBe("Ready to Ship");
    // db:verify shipped_without_label stays green.
    const bad = await dbAll<{ id: string }>(w.db, sql`SELECT o.id FROM shipment_orders o WHERE o.status IN ('Shipped','Delivered','Partially Shipped')
      AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.label_type = 'Shipping Label' AND s.label_status = 'Active')`);
    expect(bad).toEqual([]);
  });

  it("blocks Ship when no Ready to Ship order has a label; ship stamps only the actual shipment time", async () => {
    const a = await packedOrder();
    const plan = await createPlan(w.db, auth, w.ctx, base([a]));
    expect((await listPlans(w.db, auth, q())).rows[0]?.shipBlockedReason).toMatch(/has no active shipping label/);
    expect((await shipPlans(w.db, auth, w.ctx, [plan.id])).failed[0]?.message).toMatch(/has no active shipping label\. Create a shipping label first/);
    expect(await orderStatus(a)).toBe("Ready to Ship");
    await label(a);
    await shipPlans(w.db, auth, w.ctx, [plan.id]);
    const after = await getPlanDetail(w.db, auth, plan.id);
    expect(after.status).toBe("Shipped");
    expect(after.actualShipmentAt).toBeTruthy();
    expect([after.loadingStartedAt, after.loadingCompletedAt, after.truckDepartedAt]).toEqual([null, null, null]);
  });

  it("lists the plan's unshipped orders for Picking/Job Operations and derives the consignee from orders", async () => {
    const a = (await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.product2Id, quantity: 1 }]))).id;
    const plan = await createPlan(w.db, auth, w.ctx, base([a]));
    expect(await planJobOrders(w.db, auth, [plan.id])).toMatchObject({ orderIds: [a], plans: [{ id: plan.id, orderCount: 1 }] });
    const row = (await listPlans(w.db, auth, q())).rows[0];
    const detail = await getPlanDetail(w.db, auth, plan.id);
    expect(row?.customerName).toBe(detail.customerName);
    expect(row?.customerName).toBeTruthy();
    expect(row?.customerNameHint).toBe("from orders");
    expect((await listPlans(w.db, auth, q({ filters: [{ field: "customerName", op: "ct", value: String(row?.customerName).slice(0, 3) }] }))).total).toBe(1);
  });

  it("blocks loading while an order isn't Ready to Ship, and hides a stray actual date", async () => {
    const open = (await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.product2Id, quantity: 1 }]))).id;
    const plan = await createPlan(w.db, auth, w.ctx, base([open]));
    const prog = await changePlanStatus(w.db, auth, w.ctx, plan.id, "In Progress", plan.version);
    expect(prog.statusBlocks["Loading Started"]).toMatch(/1 of 1 orders/);
    await expect(async () => await changePlanStatus(w.db, auth, w.ctx, plan.id, "Loading Started", prog.version)).rejects.toThrow(/Ready to Ship/);
    await w.db.update(schema.shipmentPlans).set({ actualShipmentAt: "2026-01-01T00:00:00Z" }).where(eq(schema.shipmentPlans.id, plan.id));
    expect((await listPlans(w.db, auth, q())).rows[0]?.actualShipmentAt).toBeNull();
    expect((await getPlanDetail(w.db, auth, plan.id)).actualShipmentAt).toBeNull();
  });

  it("edits inline fields with the row version", async () => {
    const plan = await createPlan(w.db, auth, w.ctx, base([]));
    const updated = await quickUpdatePlan(w.db, auth, w.ctx, plan.id, { version: plan.version, truckPlateNumber: "KS 7001" });
    expect(updated.truckPlateNumber).toBe("KS 7001");
    await expect(async () => await quickUpdatePlan(w.db, auth, w.ctx, plan.id, { version: updated.version, loadingStartedAt: new Date().toISOString() })).rejects.toThrow(/Loading Started/);
    await expect(async () => await quickUpdatePlan(w.db, auth, w.ctx, plan.id, { version: plan.version, truckPlateNumber: "X" })).rejects.toThrow();
  });

  it("edits with optimistic concurrency and writes a change log", async () => {
    const plan = await createPlan(w.db, auth, w.ctx, base([]));
    const updated = await updatePlan(w.db, auth, w.ctx, plan.id, { ...base([]), truckPlateNumber: "KS 2002", version: plan.version });
    expect(updated.truckPlateNumber).toBe("KS 2002");
    await expect(async () => await updatePlan(w.db, auth, w.ctx, plan.id, { ...base([]), version: plan.version })).rejects.toThrow();
    const log = await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, plan.id));
    expect(log.some((l) => JSON.stringify(l).includes("KS 2002"))).toBe(true);
    expect((await deletePlans(w.db, auth, w.ctx, [plan.id])).succeeded).toEqual([plan.id]);
  });
});

describe("Shipment History", () => {
  it("has one row per shipped ledger line with quantities equal to the ledger", async () => {
    const a = await packedOrder(4);
    await label(a);
    const plan = await createPlan(w.db, auth, w.ctx, {
      code: "KS-E2E-SP-H", warehouseId: w.warehouseId, clientId: null, carrierConnectionId: null, truckPlateNumber: null, loadingGateLocationId: null,
      status: "Open", plannedShipmentAt: null, actualShipmentAt: null, loadingStartedAt: null, loadingCompletedAt: null, truckDepartedAt: null,
      expectedTotalVolume: 0, expectedTotalWeight: 0, preventLpnEditDuringLoading: false, note: null, customerId: null, customerAddressId: null,
      retailerId: null, customFields: {}, orderIds: [a],
    });
    await shipPlans(w.db, auth, w.ctx, [plan.id]);
    const history = (await listShipmentHistory(w.db, auth, q({ filters: [{ field: "shipmentType", op: "in", values: ["Shipment Order"] }] }))).rows;
    const ledgerQty = (await w.db.select().from(schema.inventoryTransactions).where(eq(schema.inventoryTransactions.type, "Shipment"))).reduce((s, t) => s + Math.abs(t.uomQty), 0);
    expect(history.reduce((s, r) => s + r.quantity, 0)).toBe(ledgerQty);
    expect(ledgerQty).toBe(4);
  });
});
