/** Pure M05 logic: wizard step schemas, payload mapping, rail percent, tracking issues, receive-form validation. */
import { describe, expect, it } from "vitest";
import { detailsStepSchema, emptyValues, linesTotal, productsStepSchema, stepPercent, toPayload, vendorStepSchema } from "@/components/receiving/wizard/po-form-model";
import { cancelReason, deleteReason, receiveReason } from "@/components/receiving/po-list-page";
import { purchasePriceOf, receivingDifference, trackingIssues } from "@/lib/grid-defs/receiving/po-schemas";
import type { PoRow } from "@/components/receiving/receiving-shared";

const row = (over: Partial<PoRow>): PoRow => ({
  id: "1", code: "PO1", vendorId: null, vendorName: "V", referenceNumber: null, purchasePrice: 0, totalQuantity: 10, receivedQuantity: 0, status: "Pending",
  rawStatus: "Pending", poType: "Purchase Order", tags: [], poDate: null, clientId: "c", clientName: "C", warehouseId: "w", warehouseName: "W",
  createdAt: "", plannedReceivingDate: null, receivedAt: null, plannedArrivalDate: null, actualArrivalDate: null, activeReceipts: 0, version: 1,
  receivingLocationCode: null, ...over,
});

describe("PO wizard model", () => {
  it("step 1 requires warehouse, client, number, type and date and surfaces a code conflict on `code`", () => {
    const empty = detailsStepSchema.safeParse({ ...emptyValues(), poDate: "" });
    const paths = empty.error?.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["warehouseId", "clientId", "code", "poDate"]));
    const conflict = detailsStepSchema.safeParse({ ...emptyValues({ warehouseId: "w", clientId: "c" }), code: "PO-1", codeConflict: "This purchase order code already exists (PO-1)" });
    expect(conflict.error?.issues[0]).toMatchObject({ path: ["code"], message: "This purchase order code already exists (PO-1)" });
  });

  it("steps 2 and 3 need a line and exactly one vendor", () => {
    expect(productsStepSchema.safeParse({ lines: [] }).error?.issues[0]?.message).toBe("Add at least one product");
    expect(vendorStepSchema.safeParse({ vendorId: "" }).error?.issues[0]?.message).toBe("Select a vendor");
  });

  it("maps the payload, blanking empty text and computing the price total", () => {
    const v = { ...emptyValues({ warehouseId: "w", clientId: "c" }), code: " PO-9 ", referenceNumber: "  ", vendorId: "v" };
    const payload = toPayload(v, 3);
    expect(payload).toMatchObject({ code: "PO-9", referenceNumber: null, vendorId: "v", version: 3 });
    expect(linesTotal([{ orderedQuantity: 3, unitCost: 1.115 }, { orderedQuantity: 2, unitCost: 2 }])).toBe(7.35);
    expect(purchasePriceOf([{ orderedQuantity: 10, unitCost: 5 }])).toBe(50);
  });

  it("rail ring goes %0 → %100 across 5 steps", () => {
    expect([0, 1, 2, 3, 4].map((i) => stepPercent(i))).toEqual([0, 25, 50, 75, 100]);
  });
});

describe("receiving rules", () => {
  it("lists tracking issues by field", () => {
    const issues = trackingIssues({ quantity: 2, serials: ["A"] }, { lot: true, expiry: true, production: false, serial: true }, "SKU1");
    expect(Object.keys(issues).sort()).toEqual(["expiryDate", "lotNumber", "serials"]);
    expect(issues.serials).toBe("2 serial numbers required; 1 entered.");
    expect(trackingIssues({ quantity: 1, lotNumber: "L1" }, { lot: true, expiry: false, production: false, serial: false }, "S")).toEqual({});
  });

  it("difference is received − ordered", () => {
    expect(receivingDifference(10, 6)).toBe(-4);
    expect(receivingDifference(10, 12)).toBe(2);
  });

  it("bulk guards explain why an action is unavailable", () => {
    expect(cancelReason([row({ status: "Completed" })])).toMatch(/Only Pending or Started/);
    expect(cancelReason([row({ activeReceipts: 1 })])).toMatch(/Cancel its receipts first/);
    expect(receiveReason([row({ status: "Started" })])).toBeNull();
    expect(deleteReason([row({ receivedQuantity: 2 })])).toMatch(/without receipts/);
    expect(deleteReason([row({})])).toBeNull();
  });
});
