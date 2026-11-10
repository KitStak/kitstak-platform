/** Client-side drawer schemas (inline errors before the server sees the request). */
import { describe, expect, it } from "vitest";
import { addInventorySchema } from "@/components/inventory/add-inventory-drawer";
import { quantitySchema, resultingQty } from "@/components/inventory/quantity-drawer";
import { transferProductSchema } from "@/components/inventory/transfer-product-drawer";
import { attributeSchema } from "@/components/inventory/change-attributes-drawer";

const EMPTY = {
  warehouseId: null, locationId: null, lpId: null, clientId: null, productId: null, packType: null, reasonId: null,
  damageReason: null, qty: null, lotNumber: "", expiryDate: null, productionDate: null, note: "",
};
const paths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) => (r.error?.issues ?? []).map((i) => String(i.path[0])).sort();

describe("Add Inventory schema", () => {
  it("reports every missing required field at once", () => {
    const r = addInventorySchema({ reasonRequired: true, product: null }).safeParse(EMPTY);
    expect(paths(r)).toEqual(["clientId", "locationId", "packType", "productId", "qty", "reasonId", "warehouseId"]);
  });
  it("requires tracked attributes", () => {
    const product = { productId: "p", sku: "S", uom: "Each", packTypes: [], trackLot: true, trackExpiry: true, trackProductionDate: false };
    const r = addInventorySchema({ reasonRequired: false, product }).safeParse({ ...EMPTY, warehouseId: "w", locationId: "l", clientId: "c", productId: "p", packType: "Each", qty: 1 });
    expect(paths(r)).toEqual(["expiryDate", "lotNumber"]);
  });
});

describe("Quantity drawer schema", () => {
  const row = { totalPackQty: 20, freePackQty: 15, allocatedPackQty: 5 };
  it("guards adjust below allocated and unchanged quantity", () => {
    expect(paths(quantitySchema("adjust", row, false).safeParse({ qty: 4, reasonId: null, note: "" }))).toEqual(["qty"]);
    expect(paths(quantitySchema("adjust", row, false).safeParse({ qty: 20, reasonId: null, note: "" }))).toEqual(["qty"]);
    expect(quantitySchema("adjust", row, false).safeParse({ qty: 18, reasonId: null, note: "" }).success).toBe(true);
  });
  it("guards remove above free stock and missing reason", () => {
    expect(paths(quantitySchema("remove", row, true).safeParse({ qty: 16, reasonId: null, note: "" }))).toEqual(["qty", "reasonId"]);
  });
  it("previews the resulting quantity", () => {
    expect(resultingQty("add", 20, 5)).toBe(25);
    expect(resultingQty("remove", 20, 5)).toBe(15);
    expect(resultingQty("adjust", 20, 18)).toBe(18);
    expect(resultingQty("adjust", 20, null)).toBeNull();
  });
});

describe("Transfer and attribute schemas", () => {
  it("transfer needs a quantity within free stock and a target", () => {
    expect(paths(transferProductSchema(10).safeParse({ qty: 11, target: null }))).toEqual(["qty", "target"]);
    expect(transferProductSchema(10).safeParse({ qty: 5, target: { kind: "location", id: "x" } }).success).toBe(true);
  });
  it("over-quantity uses Logiwa's copy and names what is available", () => {
    const r = transferProductSchema(21).safeParse({ qty: 99, target: { kind: "location", id: "x" } });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("The entered transfer quantity exceeds the existing inventory amount (21 available).");
  });
  it("attribute change must differ from the current value", () => {
    const single = { lotNumber: "L1", freePackQty: 4 } as never;
    expect(paths(attributeSchema("lotNumber", single).safeParse({ value: "L1", qty: null }))).toEqual(["value"]);
    expect(paths(attributeSchema("lotNumber", single).safeParse({ value: "L2", qty: 9 }))).toEqual(["qty"]);
  });
});

describe("quantity inputs never coerce (critic round 2)", () => {
  it("parses text without rounding or clamping", async () => {
    const { parseQtyText, qtyIssue } = await import("@/components/inventory/inventory-form-kit");
    expect(parseQtyText("-2")).toBe(-2);
    expect(parseQtyText("1.5")).toBe(1.5);
    expect(parseQtyText("1,234")).toBe(1234);
    expect(Number.isNaN(parseQtyText("abc") as number)).toBe(true);
    expect(parseQtyText("")).toBeNull();
    expect(qtyIssue(-2)).toBe("Must be greater than 0");
    expect(qtyIssue(0)).toBe("Must be greater than 0");
    expect(qtyIssue(0, { allowZero: true })).toBeNull();
    expect(qtyIssue(1.5)).toBe("Use a whole number");
    expect(qtyIssue(Number.NaN)).toBe("Enter a number");
    expect(qtyIssue(99_999_999)).toBe("Enter at most 10,000,000");
  });
  it("remove/transfer/add schemas reject what the box shows instead of rewriting it", () => {
    const row = { totalPackQty: 5, freePackQty: 5, allocatedPackQty: 0 };
    const msg = (r: { error?: { issues: { message: string }[] } }) => r.error?.issues.map((i) => i.message);
    expect(msg(quantitySchema("remove", row, true).safeParse({ qty: 50, reasonId: null, note: "" }))).toEqual(["Adjustment Reason is required", "Only 5 unallocated can be removed"]);
    expect(msg(quantitySchema("remove", row, false).safeParse({ qty: 1.5, reasonId: null, note: "" }))).toEqual(["Use a whole number"]);
    expect(quantitySchema("adjust", row, false).safeParse({ qty: 0, reasonId: null, note: "" }).success).toBe(true);
    expect(msg(transferProductSchema(5).safeParse({ qty: -2, target: { kind: "location", id: "x" } }))).toEqual(["Must be greater than 0"]);
    expect(paths(addInventorySchema({ reasonRequired: false, product: null }).safeParse({ ...EMPTY, warehouseId: "w", locationId: "l", clientId: "c", productId: "p", packType: "Each", qty: 0, lotNumber: "<b>" }))).toEqual(["lotNumber", "qty"]);
  });
});
