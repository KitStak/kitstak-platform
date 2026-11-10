/** M08 pure model: formulas, guards, zod contracts and grid definitions. */
import { describe, expect, it } from "vitest";
import {
  ageInDays, cancelPickingReason, cancelReason, createKitReason, createKitSchema, deleteReason, disassembleReason, editReason,
  netKittingCapacity, pickingReason, remainingQty, reorderQty, requiredKittingQty, selectionReason, workOrderInputSchema,
  WO_UNSAVED_DESCRIPTION, WO_UNSAVED_TITLE, type WoActionRow,
} from "@/lib/grid-defs/work-orders/work-order-model";
import { WORK_ORDER_COLUMNS, WORK_ORDER_GRID_FIELDS, WORK_ORDER_SORT_FIELDS } from "@/lib/grid-defs/work-orders/work-orders";
import { KIT_COMPONENT_EXPORT_COLUMNS, KIT_INVENTORY_EXPORT_COLUMNS } from "@/lib/grid-defs/work-orders/kits";

const row = (extra: Partial<WoActionRow & { code: string }> = {}): WoActionRow & { code: string } => ({
  code: "WO000001", status: "Open", type: "Work Order without Picking", requestedQty: 5, processedQty: 0, ...extra,
});

describe("formulas", () => {
  it("net kitting capacity is the minimum floor(free / bom)", () => {
    expect(netKittingCapacity([{ bomQty: 2, freeQty: 22 }])).toBe(11);
    expect(netKittingCapacity([{ bomQty: 2, freeQty: 30 }, { bomQty: 1, freeQty: 12 }])).toBe(12);
    expect(netKittingCapacity([{ bomQty: 3, freeQty: 8 }, { bomQty: 1, freeQty: 100 }])).toBe(2);
    expect(netKittingCapacity([{ bomQty: 2, freeQty: -5 }])).toBe(0);
    expect(netKittingCapacity([])).toBe(0);
  });
  it("required kitting and reorder quantities never go negative", () => {
    expect(requiredKittingQty(10, 4)).toBe(6);
    expect(requiredKittingQty(3, 4)).toBe(0);
    expect(reorderQty(1400, 442)).toBe(958);
    expect(reorderQty(10, 50)).toBe(0);
  });
  it("age and remaining qty", () => {
    expect(ageInDays("2026-11-01T00:00:00Z", new Date("2026-11-06T12:00:00Z"))).toBe(5);
    expect(ageInDays("not a date")).toBe(0);
    expect(remainingQty({ requestedQty: 5, processedQty: 2 })).toBe(3);
  });
});

describe("action guards", () => {
  it("edit / delete / cancel", () => {
    expect(editReason(row())).toBeNull();
    expect(editReason(row({ status: "Completed" }))).toMatch(/can't be edited/);
    expect(deleteReason(row())).toBeNull();
    expect(deleteReason(row({ status: "In Process" }))).toBe("Only Open work orders can be deleted");
    expect(cancelReason(row({ processedQty: 1, status: "In Process" }))).toMatch(/already built/);
  });
  it("create kit and disassemble", () => {
    expect(createKitReason(row())).toBeNull();
    expect(createKitReason(row({ type: "Work Order with Picking" }))).toMatch(/Picking\/Job Operations/);
    expect(createKitReason(row({ status: "Shortage" }))).toMatch(/short/);
    expect(disassembleReason(row())).toMatch(/No kits/);
    expect(disassembleReason(row({ processedQty: 2, status: "Completed" }))).toBeNull();
  });
  it("picking and cancel picking", () => {
    expect(pickingReason(row())).toMatch(/Only work orders with picking/);
    expect(pickingReason(row({ type: "Work Order with Picking" }))).toBeNull();
    expect(pickingReason(row({ type: "Work Order with Picking", status: "Completed" }))).toMatch(/Only Open or Shortage/);
    expect(cancelPickingReason(row({ type: "Work Order with Picking", status: "In Process" }))).toBeNull();
    expect(cancelPickingReason(row({ type: "Work Order with Picking" }))).toMatch(/In Process or Shortage/);
  });
  it("selection reasons name the first failing work order", () => {
    expect(selectionReason([], createKitReason)).toBe("Select at least one work order");
    expect(selectionReason([row(), row({ code: "WO2" })], createKitReason, { single: true })).toBe("Select one work order");
    expect(selectionReason([row(), row({ code: "WO2", status: "Cancelled" })], deleteReason)).toBe("WO2: Only Open work orders can be deleted");
    expect(selectionReason([row()], deleteReason)).toBeNull();
  });
});

describe("contracts", () => {
  const base = { warehouseId: "w", clientId: "c", code: "WO-1", type: "Work Order without Picking", kitProductId: "k", requestedQty: 5 };
  it("requires Logiwa's mandatory fields with readable messages", () => {
    const res = workOrderInputSchema.safeParse({});
    expect(res.success).toBe(false);
    const messages = res.success ? [] : res.error.issues.map((i) => i.message);
    expect(messages).toContain("Select warehouse is required.");
    expect(messages).toContain("Select client is required.");
  });
  it("Build For SO needs an order; dates must be ordered", () => {
    expect(workOrderInputSchema.safeParse({ ...base, buildFor: "SO" }).success).toBe(false);
    expect(workOrderInputSchema.safeParse({ ...base, buildFor: "SO", shipmentOrderId: "so" }).success).toBe(true);
    const bad = workOrderInputSchema.safeParse({ ...base, plannedStartAt: "2026-11-06T10:00:00Z", plannedFinishAt: "2026-11-05T10:00:00Z" });
    expect(bad.success ? null : bad.error.issues[0]?.path).toEqual(["plannedFinishAt"]);
  });
  it("rejects bad codes and quantities", () => {
    expect(workOrderInputSchema.safeParse({ ...base, code: "has space" }).success).toBe(false);
    expect(workOrderInputSchema.safeParse({ ...base, requestedQty: 0 }).success).toBe(false);
    expect(workOrderInputSchema.safeParse({ ...base, requestedQty: 1.5 }).success).toBe(false);
    expect(createKitSchema.safeParse({ workOrderId: "x", qty: 1 }).success).toBe(false);
  });
  it("keeps Logiwa's unsaved-changes copy", () => {
    expect(WO_UNSAVED_TITLE).toBe("You have unsaved changes!");
    expect(WO_UNSAVED_DESCRIPTION).toMatch(/^If you leave this form, all unsaved changes will be lost\./);
  });
});

describe("grid definitions", () => {
  it("has the 20 Logiwa columns and 22 filters", () => {
    expect(WORK_ORDER_COLUMNS).toHaveLength(20);
    expect(WORK_ORDER_GRID_FIELDS.length).toBeGreaterThanOrEqual(22);
    expect(new Set(WORK_ORDER_GRID_FIELDS.map((f) => f.field)).size).toBe(WORK_ORDER_GRID_FIELDS.length);
    for (const c of WORK_ORDER_COLUMNS.filter((x) => x.key !== "tagNames")) expect(WORK_ORDER_SORT_FIELDS as readonly string[]).toContain(c.key);
    expect(KIT_INVENTORY_EXPORT_COLUMNS.length).toBeGreaterThan(10);
    expect(KIT_COMPONENT_EXPORT_COLUMNS.map((c) => c.key)).toContain("reorderQty");
  });
});
