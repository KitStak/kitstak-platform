import { describe, expect, it } from "vitest";
import { byLocationFilters } from "@/components/inventory/inventory-links";

describe("byLocationFilters", () => {
  it("filters by SKU only for the All Warehouses row", () => {
    expect(byLocationFilters("SKU-1", null)).toEqual([{ field: "sku", op: "eq", value: "SKU-1" }]);
  });
  it("adds the warehouse for a warehouse-scoped row", () => {
    expect(byLocationFilters("SKU-1", "wh1")).toEqual([
      { field: "sku", op: "eq", value: "SKU-1" },
      { field: "warehouseId", op: "in", values: ["wh1"] },
    ]);
  });
});
