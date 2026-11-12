/** sequences, change-log, state machines, conditions, facts sorting, bulk, errors. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import { diffRows, formatValue, humanize, lastFromValue, recordCreate, recordDelete, recordLine, recordUpdate } from "@/server/domain/change-log";
import { evaluateCondition, evaluateConditions, evaluateFilter, evaluateFilters } from "@/server/domain/conditions";
import { describeError, DomainError, NotImplementedError } from "@/server/domain/errors";
import { sortByClauses } from "@/server/domain/facts";
import { billNumber, formatCode, instantCountCode, next, nextInteger, nextLpNumber, peek, waveNumber } from "@/server/domain/sequences";
import { stateMachines } from "@/server/domain/state-machines";
import { checkScope, systemCtx } from "@/server/domain/types";
import { createWorld, type World } from "./fixtures";

let w: World;
beforeEach(async () => { w = await createWorld(); });
afterEach(() => w.close());

describe("sequences", () => {
  it("formats, peeks without consuming and advances", async () => {
    expect(formatCode("SO", 12, 6)).toBe("SO000012");
    expect(await peek(w.db, "so")).toBe("SO000001");
    expect(await next(w.db, "so")).toBe("SO000001");
    expect(await next(w.db, "so")).toBe("SO000002");
    expect(await peek(w.db, "so")).toBe("SO000003");
  });

  it("bootstraps from the highest existing code", async () => {
    await w.db.insert(schema.purchaseOrders).values({ code: "PO000041", warehouseId: w.warehouseId, clientId: w.clientId, vendorName: "V", status: "Pending", totalQuantity: 1, purchasePrice: 1 });
    await w.db.insert(schema.purchaseOrders).values({ code: "PO-LEGACY", warehouseId: w.warehouseId, clientId: w.clientId, vendorName: "V", status: "Pending", totalQuantity: 1, purchasePrice: 1 });
    expect(await peek(w.db, "po")).toBe("PO000042");
    expect(await next(w.db, "po")).toBe("PO000042");
  });

  it("keeps per-warehouse counters and unknown keys", async () => {
    expect(await next(w.db, "rma", w.warehouseId)).toBe("RMA000001");
    expect(await next(w.db, "rma")).toBe("RMA000001");
    expect(await next(w.db, "custom")).toBe("CUSTOM000001");
    expect(await nextInteger(w.db, "receipt")).toBe(1);
    expect(await nextInteger(w.db, "receipt")).toBe(2);
  });

  it("builds wave, instant count, bill and LP numbers", async () => {
    expect(waveNumber(3, 14)).toBe("3-14");
    expect(instantCountCode(new Date(Date.UTC(2026, 10, 5, 9, 8, 7, 6)))).toBe("IC20261105090807006");
    const at = new Date(Date.UTC(2026, 10, 5));
    expect(await billNumber(w.db, at)).toBe("261105001");
    expect(await billNumber(w.db, at)).toBe("261105002");
    const lpType = (await w.db.insert(schema.lpTypes).values({ warehouseId: w.warehouseId, code: "PAL", numberPrefix: "LP", numberLength: 5 }).returning())[0];
    expect(await nextLpNumber(w.db, lpType.id)).toBe("LP00001");
    expect(await nextLpNumber(w.db, lpType.id)).toBe("LP00002");
    await expect(async () => await nextLpNumber(w.db, "missing")).rejects.toThrow(/LP type not found/);
  });
});

describe("change log", () => {
  it("humanizes and formats", () => {
    expect(humanize("shipCity")).toBe("Ship City");
    expect(formatValue(true)).toBe("Yes");
    expect(formatValue(null)).toBe("");
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(diffRows("shipment_order", { a: 1, version: 1, shipCity: "X" }, { a: 1, version: 2, shipCity: "Y" }))
      .toEqual([{ field: "shipCity", label: "City", from: "X", to: "Y" }]);
  });

  it("writes create / update / line / delete rows", async () => {
    await recordCreate(w.db, w.ctx, { entityType: "shipment_order", entityId: "o1", entityCode: "SO1" });
    const n = await recordUpdate(w.db, w.ctx, { entityType: "shipment_order", entityId: "o1", entityCode: "SO1", before: { status: "Open", note: null }, after: { status: "On Hold", note: null } });
    expect(n).toBe(1);
    await recordLine(w.db, w.ctx, { entityType: "purchase_order", entityId: "p", lineEntityType: "purchase_order_line", lineEntityId: "l", lineLabel: "SKU1", field: "receivedQuantity", from: 1, to: 1 });
    await recordDelete(w.db, w.ctx, { entityType: "widget", entityId: "x" });
    const rows = await w.db.select().from(schema.changeLog);
    expect(rows.map((r) => r.message)).toEqual(["Shipment Order SO1 is created.", "Status is modified. Open --> On Hold", "Widget is deleted."]);
    expect(rows[1].source).toBe("admin@test.io");
    expect(await lastFromValue(w.db, "shipment_order", "o1", "status", "On Hold")).toBe("Open");
    expect(await lastFromValue(w.db, "shipment_order", "o1", "status", "Cancelled")).toBeNull();
  });
});

describe("state machines", () => {
  const so = stateMachines.shipmentOrder;
  it("allows the fulfilment pipeline and explains rejections", () => {
    expect(so.canTransition("Open", "Ready to Pick")).toEqual({ ok: true });
    expect(so.canTransition("Open", "Open")).toMatchObject({ ok: false });
    expect(so.canTransition("Cancelled", "Open")).toEqual({ ok: false, reason: "Cancelled orders can't be changed." });
    expect(so.canTransition("Open", "Shipped")).toMatchObject({ ok: false, reason: expect.stringContaining("can't be changed to Shipped") });
    expect(so.canTransition("Open", "Cancelled")).toEqual({ ok: false, reason: "A cancel reason is required." });
    expect(so.canTransition("Open", "Cancelled", { reason: "r" })).toEqual({ ok: true });
    expect(so.canTransition("Picking Started", "Cancelled", { reason: "r" })).toMatchObject({ ok: false });
    expect(so.canTransition("On Hold", "Ready to Pick", { previousStatus: "Open" })).toMatchObject({ ok: false });
    expect(so.canTransition("On Hold", "Open", { previousStatus: "Open" })).toEqual({ ok: true });
    expect(so.canTransition("Bogus" as "Open", "Open")).toMatchObject({ ok: false });
    expect(() => so.transition("Shipped", "Open")).toThrow(DomainError);
    expect(so.path("Ready to Pick", "Ready to Ship")).toEqual(["Picking Started", "Ready to Ship"]);
    expect(so.path("Shipped", "Open")).toBeNull();
    expect(so.path("Open", "Open")).toEqual([]);
    expect(so.terminal).toEqual(["Delivered", "Cancelled"]);
    expect(so.nextStatuses("Ready to Ship")).toContain("Partially Shipped");
  });

  it("covers every other machine", () => {
    expect(stateMachines.purchaseOrder.canTransition("Receiving", "Cancelled", { activeReceipts: 2 })).toMatchObject({ ok: false });
    expect(stateMachines.purchaseOrder.canTransition("Completed", "Receiving")).toMatchObject({ ok: false, reason: expect.stringContaining("completed") });
    expect(stateMachines.job.transition("Pending", "Started")).toBe("Started");
    expect(stateMachines.task.canTransition("Completed", "Started").ok).toBe(false);
    expect(stateMachines.countPlan.transition("Count Completed", "Inventory Updated")).toBe("Inventory Updated");
    expect(stateMachines.countLine.transition("Count Completed", "Recount Created")).toBe("Recount Created");
    expect(stateMachines.workOrder.transition("Shortage", "In Process")).toBe("In Process");
    expect(stateMachines.returnOrder.transition("In Transit", "Started")).toBe("Started");
    expect(stateMachines.shipmentPlan.transition("Loading Completed", "Shipped")).toBe("Shipped");
    expect(stateMachines.endOfDay.canTransition("Closed", "Open")).toMatchObject({ ok: false, reason: expect.stringContaining("already closed") });
    expect(stateMachines.billingReport.transition("Approved", "Canceled")).toBe("Canceled");
    expect(stateMachines.wave.path("Pending", "Completed")).toEqual(["Completed"]);
  });
});

describe("conditions", () => {
  const facts = { sku: ["A-1", "B-2"], qty: 5, city: "Memphis", empty: null, flag: true, date: "2026-01-10T00:00:00.000Z", tags: [] as string[] };
  it("evaluates every comparator", () => {
    const c = (field: string, comparator: Parameters<typeof evaluateCondition>[0]["comparator"], value: Parameters<typeof evaluateCondition>[0]["value"]) => evaluateCondition({ field, comparator, value }, facts);
    expect(c("sku", "equals", "a-1")).toBe(true);
    expect(c("sku", "notEquals", "A-1")).toBe(false);
    expect(c("city", "contains", "mph")).toBe(true);
    expect(c("city", "notContains", "x")).toBe(true);
    expect(c("city", "startsWith", "Mem")).toBe(true);
    expect(c("city", "endsWith", "his")).toBe(true);
    expect(c("sku", "in", ["B-2", "C"])).toBe(true);
    expect(c("sku", "notIn", ["C"])).toBe(true);
    expect(c("empty", "in", ["Empty"])).toBe(true);
    expect(c("empty", "isEmpty", null)).toBe(true);
    expect(c("city", "isNotEmpty", null)).toBe(true);
    expect(c("qty", "between", [1, 5])).toBe(true);
    expect(c("qty", "gt", 4)).toBe(true);
    expect(c("qty", "gte", 6)).toBe(false);
    expect(c("qty", "lt", 6)).toBe(true);
    expect(c("qty", "lte", 5)).toBe(true);
    expect(c("city", "gt", 1)).toBe(false);
    expect(c("flag", "equals", true)).toBe(true);
    expect(c("date", "gt", "2026-01-01")).toBe(true);
    expect(c("tags", "isEmpty", null)).toBe(true);
    expect(evaluateConditions([], facts)).toBe(true);
    expect(evaluateConditions([{ field: "qty", comparator: "gt", value: 9 }, { field: "qty", comparator: "gt", value: 1 }], facts, "Any")).toBe(true);
    expect(evaluateConditions([{ field: "qty", comparator: "gt", value: 9 }, { field: "qty", comparator: "gt", value: 1 }], facts, "All")).toBe(false);
  });

  it("evaluates grid filter clauses", () => {
    const f = (op: Parameters<typeof evaluateFilter>[0]["op"], field: string, value: Parameters<typeof evaluateFilter>[0]["value"]) => evaluateFilter({ op, field, value, label: "" }, facts, new Date("2026-01-12T00:00:00Z"));
    expect(f("in", "sku", ["A-1"])).toBe(true);
    expect(f("nin", "sku", ["A-1"])).toBe(false);
    expect(f("eq", "city", "memphis")).toBe(true);
    expect(f("ct", "city", "emp")).toBe(true);
    expect(f("sw", "city", "M")).toBe(true);
    expect(f("ew", "city", "s")).toBe(true);
    expect(f("ex", "city", "z")).toBe(true);
    expect(f("empty", "empty", true)).toBe(true);
    expect(f("empty", "city", false)).toBe(true);
    expect(f("bool", "flag", true)).toBe(true);
    expect(f("rng", "qty", "1..10")).toBe(true);
    expect(f("rng", "qty", "..4")).toBe(false);
    expect(f("rng", "city", "1..2")).toBe(false);
    expect(f("date", "date", "last7d")).toBe(true);
    expect(f("date", "date", "bogus")).toBe(false);
    expect(f("date", "empty", "today")).toBe(false);
    expect(evaluateFilters(null, facts)).toBe(true);
  });

  it("sorts by clauses with nulls last", () => {
    const items = [{ a: null, b: 2 }, { a: "x", b: 1 }, { a: "x", b: 3 }, { a: "a", b: 9 }];
    expect(sortByClauses(items, [{ field: "a", dir: "asc" }, { field: "b", dir: "desc" }], (i) => i).map((i) => i.b)).toEqual([9, 3, 1, 2]);
    expect(sortByClauses(items, [{ field: "a", dir: "desc" }], (i) => i).map((i) => i.b)).toEqual([1, 3, 9, 2]);
  });
});

describe("bulk, errors, scope", () => {
  it("isolates failures per id", async () => {
    const r = await runBulk(w.db, ["a", "b", "a"], async (tx, id) => {
      await tx.insert(schema.tags).values({ name: `t-${id}`, color: "red" });
      if (id === "b") throw new DomainError("INVALID_STATE", "nope");
    });
    expect(r).toEqual({ succeeded: ["a"], failed: [{ id: "b", code: "INVALID_STATE", message: "nope" }] });
    expect((await w.db.select().from(schema.tags).where(eq(schema.tags.name, "t-b")).limit(1))[0]).toBeUndefined();
    await expect(async () => await runBulk(w.db, [], () => undefined)).rejects.toThrow(/at least one/);
    await expect(async () => await runBulk(w.db, Array.from({ length: 1001 }, (_, i) => String(i)), () => undefined)).rejects.toThrow(/At most/);
  });

  it("describes errors and enforces scope", () => {
    expect(describeError(new Error("x"))).toEqual({ code: "INTERNAL", message: "x" });
    expect(describeError("weird")).toEqual({ code: "INTERNAL", message: "Unexpected error" });
    const ni = new NotImplementedError("Thing", "M99");
    expect(ni.code).toBe("INVALID_STATE");
    expect(ni.details).toMatchObject({ notConfigured: true });
    expect(systemCtx().source).toBe("Scheduler");
    const ctx = { ...w.ctx, scope: { warehouseIds: [w.warehouseId], clientIds: [w.clientId] } };
    expect(() => checkScope(ctx, { warehouseId: w.warehouseId, clientId: w.otherClientId }, "Order")).toThrow(/Order not found/);
    expect(() => checkScope(ctx, { warehouseId: w.warehouseId, clientId: w.clientId }, "Order")).not.toThrow();
  });
});
