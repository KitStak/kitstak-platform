/** Orders-outbound parity round 3 (critic r2, 7.3): one priority, cancel note, duplicate log, detail helpers, eligibility, dirty guard. */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { listOrders } from "@/server/repositories/orders";
import { runOrderBulk } from "@/server/repositories/orders-bulk";
import { createOrder, createOrderBodySchema, duplicateOrder, updateOrder, updateOrderBodySchema } from "@/server/repositories/orders-commands";
import { effectiveRank, effectiveRankSql, priorityFromRank } from "@/lib/grid-defs/orders/priority";
import { eligibility, guardChecks, type EligibilityRow } from "@/components/orders/bulk/order-eligibility";
import { addressLines, linesFootnote, nextStepHint } from "@/components/orders/detail/order-detail-tabs";
import { canViewChangeLog, initialTabFromUrl, jobsAndShipmentsCount } from "@/components/orders/detail/order-detail-page";
import { hasDirtyFields } from "@/components/orders/wizard/order-wizard-shell";
import { codeTakenMessage } from "@/components/orders/wizard/step-details";
import { orderStatusTone } from "@/components/orders/order-status-pill";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
beforeEach(() => {
  w = createWorld();
});
afterEach(() => w.close());

const mk = (extra: Record<string, unknown> = {}) =>
  createOrder(w.db, w.ctx, createOrderBodySchema.parse(orderInput(w, [{ productId: w.productId, quantity: 2 }], extra)));
const logs = (id: string) => w.db.select().from(schema.changeLog).where(and(eq(schema.changeLog.entityType, "shipment_order"), eq(schema.changeLog.entityId, id))).all();
const scope = () => ({ warehouseIds: [w.warehouseId], clientIds: [w.clientId, w.otherClientId] });

describe("single priority model", () => {
  it("maps rank and level one-to-one; the level wins when only it changed", () => {
    expect([0, 1, 2, 3, 4, 9].map(priorityFromRank)).toEqual(["None", "Low", "Medium", "High", "Urgent", "Urgent"]);
    expect(effectiveRank("High", 0)).toBe(3);
    expect(effectiveRank("Urgent", 9)).toBe(9);
    expect(effectiveRank("Low", 9)).toBe(1);
    expect(effectiveRank(null, 0)).toBe(0);
    expect(effectiveRankSql("p", "r")).toContain("CASE WHEN r > 0");
  });

  it("the grid priority column, sort and numeric filter use the integer the wizard edits", () => {
    const a = mk({ priority: "High" }); // level only (e.g. a workflow): shows 3
    const b = mk({ priority: "Urgent", priorityRank: 7 });
    mk();
    const res = listOrders(w.db, scope() as never, { view: "backlog", query: { ...EMPTY_GRID_QUERY, sort: [{ field: "priority", dir: "desc" }] } });
    expect(res.rows.map((r) => r.priority)).toEqual([7, 3, 0]);
    expect(res.rows[0]?.id).toBe(b.id);
    const filtered = listOrders(w.db, scope() as never, { view: "backlog", query: { ...EMPTY_GRID_QUERY, filters: [{ field: "priorityRank", op: "rng", min: "3" }] } as never });
    expect(filtered.rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    // Saved views that filter by level ("High or Urgent") keep working.
    const byLevel = listOrders(w.db, scope() as never, { view: "backlog", query: { ...EMPTY_GRID_QUERY, filters: [{ field: "priority", op: "in", values: ["High", "Urgent"] }] } as never });
    expect(byLevel.total).toBe(2);
  });
});

describe("cancel note", () => {
  it("never overwrites the order's own Note; it is a change-log entry and an order note", () => {
    const o = mk();
    const u = updateOrder(w.db, w.ctx, o.id, updateOrderBodySchema.parse({ version: o.version, patch: { note: "Ring the bell" } }));
    const reason = w.db.insert(schema.lookupValues).values({ type: "so_cancel_reason", name: "Customer request" } as typeof schema.lookupValues.$inferInsert).returning().get();
    expect(runOrderBulk("cancel", w.db, w.ctx, { ids: [u.id], reasonId: reason.id, note: "Customer called" }).succeeded).toEqual([o.id]);
    const after = w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, o.id)).get();
    expect(after?.status).toBe("Cancelled");
    expect(after?.note).toBe("Ring the bell");
    const messages = logs(o.id).map((l) => l.message);
    expect(messages).toContain("Cancel note: Customer called");
    expect(messages.some((m) => m.startsWith("Note is modified") && m.includes("Customer called"))).toBe(false);
    const notes = w.db.select().from(schema.entityNotes).where(eq(schema.entityNotes.entityId, o.id)).all();
    expect(notes.map((n) => n.body)).toEqual(["Cancel note: Customer called"]);
  });
});

describe("duplicate order", () => {
  it("logs where the copy came from and keeps the priority", () => {
    const src = mk({ priority: "Urgent", priorityRank: 6 });
    const copy = duplicateOrder(w.db, w.ctx, src.id);
    expect(copy.priorityRank).toBe(6);
    expect(logs(copy.id).map((l) => l.message)).toContain(`Created as a duplicate of ${src.code}.`);
  });
});

describe("detail helpers", () => {
  const base = { jobs: [], hasPickTask: false, shipments: [] as never[] };
  it("next-step hint covers the real packing / shipping statuses", () => {
    expect(nextStepHint({ ...base, order: { status: "Packing Started" } })).toMatch(/label/);
    expect(nextStepHint({ ...base, order: { status: "Ready to Ship" } })).toMatch(/Create a shipping label/);
    expect(nextStepHint({ ...base, shipments: [{ labelStatus: "Active", actualShipmentAt: null }] as never[], order: { status: "Ready to Ship" } })).toMatch(/Ship the order/);
    expect(nextStepHint({ ...base, order: { status: "Partially Shipped" } })).toMatch(/remaining/);
  });
  it("cancelled orders say so under the lines", () => {
    expect(linesFootnote("Cancelled", { toAllocate: 0, cancelled: 2, shipped: 0 })).toBe("Order cancelled · 2 units cancelled");
    expect(linesFootnote("Open", { toAllocate: 2, cancelled: 0, shipped: 0 })).toBe("2 still to allocate");
  });
  it("tab badge counts jobs plus packages; ?step implies the Edit tab", () => {
    expect(jobsAndShipmentsCount({ jobs: [{}] as never[], shipments: [], order: { jobId: "j" } })).toBe(1);
    expect(jobsAndShipmentsCount({ jobs: [], shipments: [{}, {}] as never[], order: { jobId: "j" } })).toBe(3);
    expect(initialTabFromUrl("?tab=edit&step=details", ["details", "customer"])).toEqual({ tab: "edit", step: "details" });
    expect(initialTabFromUrl("?step=customer", ["details", "customer"])).toEqual({ tab: "edit", step: "customer" });
    expect(initialTabFromUrl("?tab=activity&step=details", ["details"])).toEqual({ tab: "activity", step: null });
  });
  it("change log is readable with view permission (grid kebab and detail agree)", () => {
    expect(canViewChangeLog(new Set(["fulfillment.shipment_orders.view"]))).toBe(true);
    expect(canViewChangeLog(new Set())).toBe(false);
  });
  it("formats the ship-to address", () => {
    expect(addressLines({ line1: "1 Main", city: "Austin", state: "TX", zip: "78701", country: "US" })).toEqual(["1 Main", "Austin, TX 78701", "United States"]);
  });
});

describe("shipped-tab eligibility", () => {
  const r = (status: string, extra: Partial<EligibilityRow> = {}): EligibilityRow => ({ id: status, code: status, status, jobId: null, retailerId: null, isMerged: false, hasLabel: false, hasActiveTask: false, hasSerials: false, ...extra });
  it("return info and return labels exclude Cancelled and label-less orders", () => {
    expect(eligibility.returnInfo([r("Cancelled")])).toMatch(/Shipped/);
    expect(eligibility.returnInfo([r("Shipped")])).toBeNull();
    expect(guardChecks.returnInfo(r("Cancelled"))).toBe(false);
    expect(eligibility.returnLabel([r("Shipped")])).toMatch(/shipping label/);
    expect(eligibility.returnLabel([r("Shipped", { hasLabel: true })])).toBeNull();
    expect(eligibility.voidReturnLabel([r("Shipped", { hasLabel: true })])).toMatch(/return label/);
    expect(eligibility.voidReturnLabel([r("Delivered", { hasReturnLabel: true })])).toBeNull();
    expect(eligibility.reprintShipped([r("Cancelled", { hasLabel: true })])).not.toBeNull();
  });
});

describe("wizard", () => {
  it("dirty guard ignores defaults and counts nested user edits", () => {
    expect(hasDirtyFields({})).toBe(false);
    expect(hasDirtyFields({ code: false, lines: [{}] })).toBe(false);
    expect(hasDirtyFields({ billing: { city: true } })).toBe(true);
    expect(codeTakenMessage("SO010873")).toBe("Order code SO010873 is already taken");
  });
  it("status pill uses the Logiwa palette", () => {
    expect(orderStatusTone("Open").light).toEqual({ bg: "rgb(211,240,227)", fg: "rgb(23,135,77)" });
    expect(orderStatusTone("Packing Started")).toBe(orderStatusTone("Ready to Pick"));
    expect(orderStatusTone("Ready to Pick").light.fg).toBe("rgb(13,54,163)");
    expect(orderStatusTone("Ready to Ship").light.bg).toBe("rgb(223,206,245)");
    expect(orderStatusTone("Shortage").light.fg).toBe("rgb(161,52,6)");
  });
});
