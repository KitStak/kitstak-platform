/** M01 Shipment Orders repositories against an in-memory migrated DB: grid list, detail, commands, bulk, labels/print guards, imports, search. */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { allocateOrders } from "@/server/domain/allocation";
import { createJobsFromOrders } from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { EMPTY_GRID_QUERY, type GridQuery } from "@/server/query/grid-query";
import { findOrderRow, getOrderDetail, listOrders, ordersByIds, orderViewCounts } from "@/server/repositories/orders";
import { BULK_BODY_SCHEMAS, runOrderBulk } from "@/server/repositories/orders-bulk";
import {
  changeLine, codeAvailable, createOrder, createOrderBodySchema, duplicateOrder, releaseWorkflowBlock, updateOrder, updateOrderBodySchema,
} from "@/server/repositories/orders-commands";
import { applyShipmentOrderRow, applyShipmentOrderUpdateRow, importCountry } from "@/server/repositories/orders-import";
import { REPRINT_GUARD, runLabelBulk, VOID_GUARD } from "@/server/repositories/orders-labels";
import { buildPrintRecords, PICK_LIST_GUARD } from "@/server/repositories/orders-print";
import { provider as searchProvider } from "@/server/search/providers/orders";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let scope: { warehouseIds: string[]; clientIds: "all" };

beforeEach(() => {
  w = createWorld();
  scope = { warehouseIds: [w.warehouseId], clientIds: "all" };
});
afterEach(() => w.close());

const q = (over: Partial<GridQuery> = {}): GridQuery => ({ ...EMPTY_GRID_QUERY, ...over });
const body = (lines: { productId: string; quantity: number }[], extra: Record<string, unknown> = {}) =>
  createOrderBodySchema.parse(orderInput(w, lines, extra));
const mk = (qty = 2, extra: Record<string, unknown> = {}) => createOrder(w.db, w.ctx, body([{ productId: w.productId, quantity: qty }], extra));
const stock = (qty: number, productId = w.productId) =>
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId, locationId: w.loc.storageA, qty });
const row = (id: string) => w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).get();
const logs = (id: string) => w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, id)).all();
const auth = () => ({ scope, viewScope: scope, permissions: new Set<string>(), user: { id: w.userId } }) as unknown as AuthContext;

describe("createOrder (wizard save)", () => {
  it("creates an Open order with product-master weight, a Create entry and one entry per line", () => {
    const o = createOrder(w.db, w.ctx, body([{ productId: w.productId, quantity: 2 }, { productId: w.product2Id, quantity: 1 }], { code: "KS-E2E-SO-1", taxType: "VAT", bol: "BOL-1" }));
    expect(o).toMatchObject({ code: "KS-E2E-SO-1", status: "Open", totalQuantity: 3, totalWeightOz: 24, taxType: "VAT", bol: "BOL-1" });
    expect(o.shipState).toBe("AR");
    const all = logs(o.id);
    expect(all.find((l) => l.type === "Create")?.message).toBe("Shipment Order KS-E2E-SO-1 is created.");
    const lineLogs = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.parentEntityId, o.id)).all();
    expect(lineLogs.map((l) => l.message)).toEqual(expect.arrayContaining([expect.stringMatching(/^MLT-WIDGET-01 -> /), expect.stringMatching(/^MLT-GADGET-02 -> /)]));
  });

  it("checks code uniqueness case-insensitively and rejects a customer of another client", () => {
    const o = mk(1, { code: "SO-UNIQ" });
    expect(codeAvailable(w.db, "so-uniq")).toBe(false);
    expect(codeAvailable(w.db, "so-uniq", o.id)).toBe(true);
    expect(codeAvailable(w.db, "SO-FREE")).toBe(true);
    const cust = w.db.insert(schema.customers).values({ clientId: w.otherClientId, firstName: "O", lastName: "T", email: "o@x.io", phone: "1", name: "Other", code: "C1" } as typeof schema.customers.$inferInsert).returning().get();
    expect(() => mk(1, { customerId: cust.id })).toThrow(/Customer not found/);
  });
});

describe("updateOrder (detail edit)", () => {
  it("logs extra fields with readable values and raises CONFLICT on a stale version", () => {
    const o = mk();
    const u = updateOrder(w.db, w.ctx, o.id, updateOrderBodySchema.parse({ version: o.version, patch: { note: "Leave at door", pro: "PRO-77" } }));
    expect(u.version).toBeGreaterThan(o.version);
    expect(logs(o.id).map((l) => l.message)).toEqual(expect.arrayContaining(["Note is modified.  --> Leave at door", expect.stringMatching(/is modified\.  --> PRO-77$/)]));
    expect(() => updateOrder(w.db, w.ctx, o.id, updateOrderBodySchema.parse({ version: o.version, patch: { note: "stale" } }))).toThrow(/changed since/);
  });

  it("locks warehouse and client and only allows notes/return info on terminal orders", () => {
    const o = mk();
    const locked = updateOrder(w.db, w.ctx, o.id, updateOrderBodySchema.parse({ version: o.version, patch: { clientId: w.otherClientId, note: "n" } }));
    expect(locked.clientId).toBe(w.clientId);
    runOrderBulk("cancel", w.db, w.ctx, { ids: [o.id], reasonId: "r1" });
    const c = row(o.id);
    expect(() => updateOrder(w.db, w.ctx, o.id, updateOrderBodySchema.parse({ version: c?.version, patch: { bol: "X" } }))).toThrow(/Only notes/);
  });

  it("adds, edits and deletes lines but never removes the last line", () => {
    const o = mk(2);
    const a = changeLine(w.db, w.ctx, o.id, o.version, { kind: "add", line: { productId: w.product2Id, quantity: 4 } });
    expect(a.totalQuantity).toBe(6);
    const lines = w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).all();
    const e = changeLine(w.db, w.ctx, o.id, a.version, { kind: "edit", lineId: lines[0]!.id, patch: { quantity: 1 } });
    const d = changeLine(w.db, w.ctx, o.id, e.version, { kind: "delete", lineId: lines[1]!.id });
    expect(d.totalQuantity).toBe(1);
    expect(() => changeLine(w.db, w.ctx, o.id, d.version, { kind: "delete", lineId: lines[0]!.id })).toThrow(/at least one line/);
    expect(() => changeLine(w.db, w.ctx, o.id, d.version, { kind: "edit", lineId: "nope", patch: {} })).toThrow(/not found/);
  });

  it("duplicates an order into a new Open order", () => {
    const o = mk(3, { retailerPo: "PO-9" });
    const copy = duplicateOrder(w.db, w.ctx, o.id);
    expect(copy.id).not.toBe(o.id);
    expect(copy).toMatchObject({ status: "Open", totalQuantity: 3, retailerPo: "PO-9", channel: "Manual" });
  });

  it("releases a workflow block once", () => {
    const o = mk();
    expect(() => releaseWorkflowBlock(w.db, w.ctx, o.id, o.version)).toThrow(/not blocked/);
    w.db.update(schema.shipmentOrders).set({ workflowBlocked: "Blocked" } as never).where(eq(schema.shipmentOrders.id, o.id)).run();
    const r = releaseWorkflowBlock(w.db, w.ctx, o.id, o.version);
    expect(r.workflowBlocked).toBe("None");
  });
});

describe("listOrders (grid grammar)", () => {
  it("returns correlated columns per order (SKU list, tags, allocated) — not the subquery's own id", () => {
    const a = createOrder(w.db, w.ctx, body([{ productId: w.productId, quantity: 1 }, { productId: w.product2Id, quantity: 2 }]));
    const b = mk(5);
    const res = listOrders(w.db, scope, { view: "backlog", query: q({ sort: [{ field: "code", dir: "asc" }] } as never) });
    expect(res.total).toBe(2);
    const byId = new Map(res.rows.map((r) => [r.id, r as unknown as Record<string, unknown>]));
    expect(String(byId.get(a.id)?.skus).split(" / ").sort()).toEqual(["MLT-GADGET-02", "MLT-WIDGET-01"]);
    expect(byId.get(b.id)?.skus).toBe("MLT-WIDGET-01");
    expect(byId.get(b.id)?.hasActiveTask).toBe(false);
    expect(byId.get(a.id)?.tags).toEqual([]);
  });

  it("splits backlog vs shipped & canceled, filters by status and quick search, and respects scope", () => {
    const a = mk(1, { code: "KS-A" });
    mk(1, { code: "KS-B" });
    runOrderBulk("cancel", w.db, w.ctx, { ids: [a.id], reasonId: "r1" });
    expect(listOrders(w.db, scope, { view: "backlog", query: q() }).total).toBe(1);
    const shipped = listOrders(w.db, scope, { view: "shipped", query: q() });
    expect(shipped.rows.map((r) => r.code)).toEqual(["KS-A"]);
    expect(listOrders(w.db, scope, { view: "backlog", query: q({ q: "KS-B", qm: "eq" }) }).total).toBe(1);
    expect(listOrders(w.db, scope, { view: "backlog", query: q({ q: "KS", qm: "sw" }) }).total).toBe(1);
    expect(listOrders(w.db, { warehouseIds: [], clientIds: "all" }, { view: "backlog", query: q() }).total).toBe(0);
    expect(orderViewCounts(w.db, scope)).toEqual({ backlog: 1, shipped: 1 });
    expect(ordersByIds(w.db, scope, [a.id]).map((r) => r.code)).toEqual(["KS-A"]);
  });

  it("finds by id or code and builds detail action reasons", () => {
    const o = mk();
    expect(findOrderRow(w.db, scope, o.code)?.id).toBe(o.id);
    const d = getOrderDetail(w.db, { scope }, o.id);
    expect(d?.jobs).toEqual([]);
    expect(d?.actions.delete).toBeNull();
    expect(d?.actions.release).toBe("Only orders on hold can be released.");
    expect(getOrderDetail(w.db, { scope: { warehouseIds: [], clientIds: "all" } }, o.id)).toBeNull();
  });
});

describe("allocate, job and cancel", () => {
  it("job shows its code on the detail; Delete/Cancel blocked with reasons; cancel releases allocations", () => {
    stock(10);
    const o = mk(3);
    allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId } as never);
    const d = getOrderDetail(w.db, { scope }, o.id);
    expect(d?.order.status).toBe("Ready to Pick");
    expect(d?.jobs[0]?.code).toMatch(/^Job/);
    expect(d?.jobs[0]?.code).not.toBe(d?.jobs[0]?.id);
    expect(d?.actions.delete).toMatch(/Only Open orders/);
    expect(d?.actions.cancel).toMatch(/in a job/);
    const cw = runOrderBulk("change-warehouse", w.db, w.ctx, {
      ids: [o.id], warehouseId: w.db.insert(schema.warehouses).values({ code: "KS2", name: "Two", addressLine: "1", city: "c", state: "TN", postalCode: "1", timezone: "America/Chicago" } as never).returning().get().id,
    });
    expect(cw.failed).toHaveLength(1);
    expect(cw.succeeded).toHaveLength(0);
  });

  it("cancel needs a reason (schema) and restores ATP", () => {
    stock(5);
    const o = mk(2);
    allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    expect(BULK_BODY_SCHEMAS.cancel.safeParse({ ids: [o.id], reasonId: "" }).success).toBe(false);
    const res = runOrderBulk("cancel", w.db, w.ctx, { ids: [o.id], reasonId: "r1" });
    expect(res.succeeded).toEqual([o.id]);
    expect(row(o.id)?.status).toBe("Cancelled");
    const alloc = w.db.select().from(schema.inventory).where(eq(schema.inventory.productId, w.productId)).all().reduce((s, r) => s + r.allocated, 0);
    expect(alloc).toBe(0);
  });

  it("logs the cancel reason by name, never by its lookup id", () => {
    const reason = w.db.insert(schema.lookupValues).values({ type: "so_cancel_reason", name: "Customer request" } as typeof schema.lookupValues.$inferInsert).returning().get();
    const o = mk(1);
    expect(runOrderBulk("cancel", w.db, w.ctx, { ids: [o.id], reasonId: reason.id }).succeeded).toEqual([o.id]);
    const entry = logs(o.id).find((l) => l.field === "cancelReasonId");
    expect(entry?.toValue).toBe("Customer request");
    expect(entry?.message).not.toContain(reason.id);
  });

  it("back-orders the short quantity into a child with masterOrderId", () => {
    stock(2);
    const o = mk(5);
    allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId, mode: "partial" });
    expect(row(o.id)?.status).toBe("Shortage");
    const res = runOrderBulk("backorder", w.db, w.ctx, { ids: [o.id] });
    expect(res.childIds).toHaveLength(1);
    const child = row(res.childIds![0]!);
    expect(child?.masterOrderId).toBe(o.id);
    expect(child?.totalQuantity).toBe(3);
  });

  it("hold / release / delete / short and serial guards report per-id results", () => {
    const o = mk();
    expect(runOrderBulk("hold", w.db, w.ctx, { ids: [o.id] }).succeeded).toEqual([o.id]);
    expect(row(o.id)?.status).toBe("On Hold");
    expect(runOrderBulk("release", w.db, w.ctx, { ids: [o.id] }).succeeded).toEqual([o.id]);
    expect(runOrderBulk("resolve-pick-short", w.db, w.ctx, { ids: [o.id] }).failed[0]?.message).toMatch(/no open pick short/);
    expect(runOrderBulk("cancel-picking", w.db, w.ctx, { ids: [o.id] }).failed[0]?.message).toMatch(/active picking\/packing tasks/);
    expect(runOrderBulk("remove-serials", w.db, w.ctx, { ids: [o.id] }).failed[0]?.message).toMatch(/no serial numbers/);
    expect(runOrderBulk("update-return-info", w.db, w.ctx, { ids: [o.id], returnShippingCost: 3 }).failed[0]?.message).toMatch(/shipped orders/);
    expect(runOrderBulk("delete", w.db, w.ctx, { ids: [o.id] }).succeeded).toEqual([o.id]);
    expect(row(o.id)?.deletedAt).toBeTruthy();
    expect(listOrders(w.db, scope, { view: "backlog", query: q() }).total).toBe(0);
  });
});

describe("label and print guards", () => {
  it("uses Logiwa's exact guard copy for reprint/void without a label and for the picking list", async () => {
    const o = mk();
    const reprint = await runLabelBulk(w.db, w.ctx, { action: "reprint", ids: [o.id] });
    expect(reprint.failed[0]?.message).toBe(REPRINT_GUARD);
    const voided = await runLabelBulk(w.db, w.ctx, { action: "void", ids: [o.id] });
    expect(voided.failed[0]?.message).toBe(VOID_GUARD);
    const pick = buildPrintRecords(w.db, scope, { type: "picking-list", ids: [o.id] } as never);
    expect(pick.ineligible[0]?.reason).toBe(PICK_LIST_GUARD);
    const slip = buildPrintRecords(w.db, scope, { type: "packing-slip", ids: [o.id] } as never);
    expect(slip.records).toHaveLength(1);
  });
});

describe("imports", () => {
  const ctxFor = (batchId: string, rowNumber = 1) => ({ db: w.db, auth: auth(), actor: { userId: w.userId, source: "import" }, batchId, rowNumber });
  const base = { clientCode: "ACME", warehouseCode: "MLT1", shipToName: "Ann", shipToAddress1: "1 Main", shipToCity: "Memphis", shipToPostalCode: "38118", shipToState: "TN", shipToCountry: "US" };

  it("groups rows by order code into one order with lines; bad rows fail alone", () => {
    applyShipmentOrderRow(ctxFor("b1", 1), { ...base, orderCode: "IMP-1", sku: "MLT-WIDGET-01", quantity: 2 });
    applyShipmentOrderRow(ctxFor("b1", 2), { ...base, orderCode: "IMP-1", sku: "MLT-GADGET-02", quantity: 1 });
    expect(() => applyShipmentOrderRow(ctxFor("b1", 3), { ...base, orderCode: "IMP-2", sku: "NOPE", quantity: 1 })).toThrow(/not found/);
    expect(() => applyShipmentOrderRow(ctxFor("b1", 4), { ...base, orderCode: "IMP-3", sku: "MLT-WIDGET-01" })).toThrow(/required/);
    const o = w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.code, "IMP-1")).get();
    expect(o?.totalQuantity).toBe(3);
    expect(o?.shipCountry).toBe(importCountry("US"));
    expect(() => applyShipmentOrderRow(ctxFor("b2"), { ...base, orderCode: "IMP-1", sku: "MLT-WIDGET-01", quantity: 1 })).toThrow(/already exists/);
  });

  it("bulk update changes only filled columns", () => {
    mk(1, { code: "UPD-1" });
    applyShipmentOrderUpdateRow(ctxFor("u1"), { orderCode: "UPD-1", shipToCity: "Nashville", priority: "high" });
    const o = w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.code, "UPD-1")).get();
    expect(o).toMatchObject({ shipCity: "Nashville", priority: "High", customerName: "Jane Doe" });
    expect(() => applyShipmentOrderUpdateRow(ctxFor("u1"), { orderCode: "UPD-1" })).toThrow(/no columns/);
  });
});

describe("global search", () => {
  it("finds an order by tracking number on its shipment label, store order # and customer", async () => {
    const o = mk(1, { storeOrderNumber: "SHP-123" });
    const other = mk(1);
    w.db.insert(schema.shipments).values({
      orderId: other.id, clientId: w.clientId, warehouseId: w.warehouseId, carrierConnectionId: w.carrierConnectionId, carrierServiceId: w.serviceIds.ground,
      trackingNumber: "1ZTRACK999", weight: 8, length: 4, width: 4, height: 2, carrierCode: "UPS", serviceName: "Ground", labelType: "Shipping Label", labelStatus: "Active",
    } as never).run();
    const ctx = (term: string) => ({ db: w.db, auth: auth(), q: term, limit: 10 }) as never;
    const ids = async (term: string) => (await searchProvider.search(ctx(term))).map((h: { id: string }) => h.id);
    expect(await ids("1ZTRACK999")).toEqual([other.id]);
    expect(await ids("SHP-123")).toEqual([o.id]);
    expect(await searchProvider.count?.(ctx("Jane"))).toBe(2);
    expect(and).toBeDefined();
  });
});
