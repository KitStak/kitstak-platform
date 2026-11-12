/** Blind-judge repair round 1 (M06): kit execution entry points, kit-type segment, import details, filters, header widths. */
import { describe, expect, it } from "vitest";
import { kitBuildDeltas, kitBuildShortages } from "@/components/kits/kit-build-preview-drawer";
import { disassembleReason, kitTypeSegment, KIT_INVENTORY_HELPER } from "@/components/kits/kit-inventory-page";
import { parseImportDetails } from "@/components/shared/import-details-drawer";
import { draftToFilter, filterToDraft, describeFilterValue } from "@/components/grid/filter-builder/filter-model";
import { headerWidth } from "@/components/inventory/inventory-shared";
import { buildBucketColumns } from "@/components/inventory/by-location-columns";
import type { FilterFieldDef } from "@/components/grid/grid-types";
import type { KitInventoryRow } from "@/lib/grid-defs/work-orders/kits";

const kit = {
  sku: "KIT-1",
  onHandQty: 4,
  components: [
    { productId: "c1", sku: "C-1", name: "One", packType: "Each", bomQty: 2, freeQty: 10, onHandQty: 10, trackLot: false, trackExpiry: false, trackProductionDate: false },
    { productId: "c2", sku: "C-2", name: "Two", packType: "Each", bomQty: 1, freeQty: 3, onHandQty: 3, trackLot: false, trackExpiry: false, trackProductionDate: false },
  ],
};

describe("Create Kit preview", () => {
  it("adds the kit and consumes BOM × qty of every component", () => {
    const lines = kitBuildDeltas(kit, 3, "MLT1");
    expect(lines.map((l) => [l.sku, l.current, l.change])).toEqual([["KIT-1", 4, 3], ["C-1", 10, -6], ["C-2", 3, -3]]);
  });
  it("flags components that would go below zero", () => {
    expect(kitBuildShortages(kit, 3)).toEqual({});
    expect(kitBuildShortages(kit, 5)).toEqual({ c2: 2 });
    expect(kitBuildShortages(kit, 6)).toEqual({ c1: 2, c2: 3 });
  });
});

describe("Kit Inventory page", () => {
  it("explains both kit types in the helper", () => {
    expect(KIT_INVENTORY_HELPER).toMatch(/Kit to Stock/);
    expect(KIT_INVENTORY_HELPER).toMatch(/Kit to Order/);
  });
  it("maps the Kit Type filter to a segment", () => {
    expect(kitTypeSegment([])).toBe("all");
    expect(kitTypeSegment([{ field: "kitType", op: "in", values: ["Kit to Stock"] }])).toBe("Kit to Stock");
    expect(kitTypeSegment([{ field: "kitType", op: "in", values: ["Kit to Stock", "Kit to Order"] }])).toBe("custom");
  });
  it("only offers Disassemble when there is kit stock and permission", () => {
    const row = { currentInventoryQty: 2 } as KitInventoryRow;
    expect(disassembleReason(row, true)).toBeNull();
    expect(disassembleReason({ ...row, currentInventoryQty: 0 }, true)).toMatch(/No kit stock/);
    expect(disassembleReason(row, false)).toMatch(/permission/);
  });
});

describe("Import details drawer", () => {
  const batch = { id: "b1", status: "Partially Successful", masterRowCount: 4, successCount: 1, errorCount: 3, createdAt: "2026-11-10T19:03:05Z", fileId: "f1", errorFileId: "f2" };
  const rows = [{ rowNumber: 2, success: true, message: "Added" }, { rowNumber: 3, success: false, message: "SKU not found" }];
  it("reads the list envelope (rows in data, batch in meta)", () => {
    const parsed = parseImportDetails({ data: rows, meta: { total: 2, batch } });
    expect(parsed?.rows).toHaveLength(2);
    expect(parsed?.batch?.status).toBe("Partially Successful");
    expect(parsed?.batch?.fileId).toBe("f1");
  });
  it("still accepts the older { batch, rows } body", () => {
    expect(parseImportDetails({ data: { batch, rows } })?.rows).toHaveLength(2);
  });
});

describe("filter editors: not in and Exclude", () => {
  const enumDef: FilterFieldDef = { field: "status", label: "Status", type: "enum", options: [{ value: "Stock", label: "Stock" }, { value: "Allocated", label: "Allocated" }] };
  const textDef: FilterFieldDef = { field: "sku", label: "SKU", type: "text" };
  it("round-trips an enum 'is none of' as nin", () => {
    const res = draftToFilter(enumDef, { type: "enum", values: ["Allocated"], exclude: true });
    expect(res).toEqual({ ok: true, filter: { field: "status", op: "nin", values: ["Allocated"] } });
    expect(filterToDraft(enumDef, { field: "status", op: "nin", values: ["Allocated"] })).toEqual({ type: "enum", values: ["Allocated"], exclude: true });
  });
  it("turns text Exclude into a nin list and back", () => {
    const res = draftToFilter(textDef, { type: "text", op: "nin", value: "A-1, B-2 ," });
    expect(res).toEqual({ ok: true, filter: { field: "sku", op: "nin", values: ["A-1", "B-2"] } });
    expect(filterToDraft(textDef, { field: "sku", op: "nin", values: ["A-1", "B-2"] })).toEqual({ type: "text", op: "nin", value: "A-1, B-2" });
    expect(describeFilterValue({ field: "sku", op: "nin", values: ["A-1"] }, textDef)).toBe("Not A-1");
  });
});

describe("By Location columns", () => {
  it("fits whole headers at their default width", () => {
    expect(headerWidth("UOM Quantity", 110, true)).toBeGreaterThanOrEqual(12 * 8.6 + 64);
    expect(headerWidth("Allocated UOM Qty", 110)).toBeGreaterThanOrEqual(17 * 8.6 + 40);
  });
  it("shows a trimmed default set with the sticky actions column", () => {
    const cols = buildBucketColumns({ onDetails: () => {}, onQuantity: () => {}, onTransfer: () => {}, can: { add: true, adjust: true, remove: true, transfer: true } });
    const visible = cols.filter((c) => (c.meta as { defaultVisible?: boolean } | undefined)?.defaultVisible !== false);
    expect(cols.length).toBeGreaterThanOrEqual(37);
    expect(visible.length).toBeLessThanOrEqual(18);
    expect(visible.map((c) => c.id)).toEqual(expect.arrayContaining(["sku", "location", "totalPackQty", "freePackQty", "status", "rowActions"]));
    expect((cols.at(-1)?.meta as { sticky?: string }).sticky).toBe("right");
  });
});
