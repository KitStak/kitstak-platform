/** Orders-outbound parity loop round 5 (critic r4, 6): header fit, backlog statuses, draft flush, change-log repair, stranded allocations. */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { allocateOrders } from "@/server/domain/allocation";
import { ledger } from "@/server/domain/ledger";
import { createOrder, createOrderBodySchema, revertStrandedAllocations } from "@/server/repositories/orders-commands";
import { orderLogLabel, repairOrderChangeLog } from "@/server/repositories/orders-change-log";
import { BACKLOG_STATUS_NOTE, BACKLOG_VIEW_STATUSES, columnsForView, filterFieldsForView, SHIPPED_VIEW_STATUSES } from "@/lib/grid-defs/orders/shipment-orders";
import { buildOrderColumns, headerFitWidth } from "@/components/orders/orders-columns";
import { flushDraftNow } from "@/components/orders/wizard/order-wizard-shell";
import { CHECKING_PERMISSIONS, permissionGate } from "@/components/orders/use-order-permissions";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

describe("backlog grid headers", () => {
  it("every default column is at least as wide as its label, and can't be resized under it", () => {
    for (const view of ["backlog", "shipped"] as const) {
      const defs = columnsForView(view);
      for (const col of buildOrderColumns(view)) {
        const label = defs.find((d) => d.id === col.id)?.label ?? "";
        const fit = headerFitWidth(label);
        expect(col.size ?? 0, label).toBeGreaterThanOrEqual(fit);
        expect(col.minSize ?? 0, label).toBe(fit);
      }
    }
  });

  it("the labels the critic saw overprint now fit", () => {
    expect(headerFitWidth("Channel Payment Status")).toBeGreaterThanOrEqual(210);
    expect(headerFitWidth("Order Processing Age")).toBeGreaterThanOrEqual(190);
  });
});

describe("backlog status filter", () => {
  it("offers Partially Shipped on the backlog (Logiwa) and keeps closed statuses on Shipped & Canceled", () => {
    expect(BACKLOG_VIEW_STATUSES).toContain("Partially Shipped");
    expect(BACKLOG_VIEW_STATUSES).not.toContain("Shipped");
    expect(BACKLOG_VIEW_STATUSES).not.toContain("Cancelled");
    expect(BACKLOG_VIEW_STATUSES).toHaveLength(13);
    expect(SHIPPED_VIEW_STATUSES).toContain("Partially Shipped");
    const backlog = filterFieldsForView("backlog").find((f) => f.field === "status");
    expect(backlog?.options?.map((o) => o.value)).toEqual([...BACKLOG_VIEW_STATUSES]);
    expect(backlog?.description).toBe(BACKLOG_STATUS_NOTE);
    expect(filterFieldsForView("shipped").find((f) => f.field === "status")?.description).toBeUndefined();
  });
});

describe("permission gate while /api/me loads", () => {
  it("controls render disabled with 'Checking permissions…', never a denial", () => {
    const loading = permissionGate(new Set(), false);
    expect(loading.reason("fulfillment.shipment_orders.create")).toBe(CHECKING_PERMISSIONS);
    const ready = permissionGate(new Set(["fulfillment.shipment_orders.create"]), true);
    expect(ready.reason("fulfillment.shipment_orders.create")).toBeNull();
    expect(ready.reason("fulfillment.shipment_orders.delete")).toMatch(/permission/);
  });
});

describe("wizard draft flush on page hide", () => {
  const store = () => {
    const map = new Map<string, string>();
    return { map, setItem: (k: string, v: string) => void map.set(k, v) };
  };
  const wizard = (dirty: unknown, completed = false) => ({
    completed,
    nav: { current: 1, reached: 1 } as never,
    form: { formState: { dirtyFields: dirty }, getValues: () => ({ code: "SO-1", shipTo: { firstName: "Ada" } }) } as never,
  });

  it("writes the draft at once when something was typed", () => {
    const s = store();
    expect(flushDraftNow(s, "order-create", wizard({ shipTo: { firstName: true } }))).toBe(true);
    const [value] = [...s.map.values()];
    expect(JSON.parse(value ?? "{}")).toMatchObject({ v: 1, values: { shipTo: { firstName: "Ada" } }, nav: { current: 1 } });
  });

  it("does nothing for an untouched or completed wizard", () => {
    const s = store();
    expect(flushDraftNow(s, "order-create", wizard({}))).toBe(false);
    expect(flushDraftNow(s, "order-create", wizard({ code: true }, true))).toBe(false);
    expect(s.map.size).toBe(0);
  });
});

describe("change-log repair (entries other modules wrote raw)", () => {
  let w: World;
  beforeEach(() => {
    w = createWorld();
  });
  afterEach(() => w.close());

  const mk = () => createOrder(w.db, w.ctx, createOrderBodySchema.parse(orderInput(w, [{ productId: w.productId, quantity: 2 }])));
  const raw = (orderId: string, code: string, field: string, label: string, from: string | null, to: string | null) =>
    w.db.insert(schema.changeLog).values({
      entityType: "shipment_order", entityId: orderId, entityCode: code, type: "Update", field, fieldLabel: label,
      fromValue: from, toValue: to, message: `${label} is modified. ${from ?? ""} --> ${to ?? ""}`, source: "Seed",
    } as typeof schema.changeLog.$inferInsert).run();
  const messages = (id: string) => w.db.select().from(schema.changeLog)
    .where(and(eq(schema.changeLog.entityType, "shipment_order"), eq(schema.changeLog.entityId, id), eq(schema.changeLog.type, "Update"))).all().map((r) => r.message);

  it("maps column-name labels to business labels", () => {
    expect(orderLogLabel("mergedIntoOrderId", "Merged Into Order Id")).toBe("Merged Into Order");
    expect(orderLogLabel("shipmentPackageId", "Shipment Package Id")).toBe("Shipment Package");
    expect(orderLogLabel("somethingId", "Something Id")).toBe("Something");
    expect(orderLogLabel("status", "Status")).toBe("Status");
  });

  it("fixes double spaces, raw ISO dates and technical labels; custom sentences and clean rows stay; idempotent", () => {
    const o = mk();
    raw(o.id, o.code, "jobId", "Job", null, "Job005319");
    raw(o.id, o.code, "mergedIntoOrderId", "Merged Into Order Id", "", "SO010907");
    raw(o.id, o.code, "cancelledAt", "Cancelled At", null, "2026-11-10T06:49:02.797Z");
    w.db.insert(schema.changeLog).values({ entityType: "shipment_order", entityId: o.id, entityCode: o.code, type: "Update", field: "cancelNote", fieldLabel: "Cancel Note", fromValue: null, toValue: "x", message: "Cancel note: x", source: "Seed" } as typeof schema.changeLog.$inferInsert).run();
    expect(repairOrderChangeLog(w.db)).toBe(3);
    const after = messages(o.id);
    expect(after).toContain("Job is modified. — --> Job005319");
    expect(after).toContain("Merged Into Order is modified. — --> SO010907");
    expect(after.some((m) => /^Cancelled At is modified\. — --> \d{1,2}\/\d{1,2}\/2026 \d{1,2}:\d{2}:\d{2} (AM|PM) [A-Z]{2,5}$/.test(m))).toBe(true);
    expect(after).toContain("Cancel note: x");
    expect(after.some((m) => m.includes(".  -->"))).toBe(false);
    expect(repairOrderChangeLog(w.db, [o.id])).toBe(0);
  });
});

describe("stranded allocations (Ready to Pick with no picking job)", () => {
  let w: World;
  beforeEach(() => {
    w = createWorld();
  });
  afterEach(() => w.close());

  const status = (id: string) => w.db.select({ s: schema.shipmentOrders.status, j: schema.shipmentOrders.jobId }).from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).get();

  it("reverts to Open once the hand-off window has passed, and leaves fresh allocations alone", () => {
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 10 });
    const o = createOrder(w.db, w.ctx, createOrderBodySchema.parse(orderInput(w, [{ productId: w.productId, quantity: 2 }])));
    allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    expect(status(o.id)).toEqual({ s: "Ready to Pick", j: null });
    expect(revertStrandedAllocations(w.db, w.ctx)).toEqual([]); // still inside the 15 min window
    expect(revertStrandedAllocations(w.db, w.ctx, { now: Date.now() + 16 * 60_000 })).toEqual([o.code]);
    expect(status(o.id)?.s).toBe("Open");
    expect(revertStrandedAllocations(w.db, w.ctx, { ids: [] })).toEqual([]);
  });
});
