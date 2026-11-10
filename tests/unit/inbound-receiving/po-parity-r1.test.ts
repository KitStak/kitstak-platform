/** Round 1 parity loop: Next gates, the status-change pills, lines CSV export and manual status stamps. */
import { describe, expect, it } from "vitest";
import {
  detailsStepSchema, emptyValues, firstIssue, LINE_CSV_HEADERS, linesCsv, productsStepSchema, statusOptionReason, vendorStepSchema, type LineDraft,
} from "@/components/receiving/wizard/po-form-model";
import { statusChangeStamps } from "@/server/repositories/purchase-orders-commands";

const line = (over: Partial<LineDraft> = {}): LineDraft => ({
  key: "k1", productId: "p1", sku: "MLT-WIDGET-01", productName: "Widget, blue", barcode: "123", imageUrl: null, uom: "Each",
  packTypes: [{ packType: "Each", uomQty: 1 }], tracking: { lot: false, expiry: false, production: false, serial: false }, packType: "Each",
  orderedQuantity: 12, unitCost: 3.25, receivedQuantity: 5, receivingLocationId: null, receivingLocationCode: "MLT1-RECV", lotNumber: null,
  expiryDate: "2027-05-01T00:00:00.000Z", productionDate: null, lpTypeId: null, lpTypeCode: null, lpNumber: null, note: 'say "hi"', ...over,
});

describe("Next Step gate (firstIssue)", () => {
  it("blocks step 1 until warehouse, client and PO number are set, with the first issue as the reason", () => {
    const v = emptyValues();
    expect(firstIssue(detailsStepSchema, v)).toBe("Warehouse is required.");
    expect(firstIssue(detailsStepSchema, { ...v, warehouseId: "w" })).toBe("Client is required.");
    expect(firstIssue(detailsStepSchema, { ...v, warehouseId: "w", clientId: "c" })).toBe("PO number is required.");
    expect(firstIssue(detailsStepSchema, { ...v, warehouseId: "w", clientId: "c", code: "KS-1" })).toBe(true);
  });
  it("a duplicate PO number keeps Next disabled", () => {
    const v = { ...emptyValues(), warehouseId: "w", clientId: "c", code: "KS-1", codeConflict: "PO number KS-1 already exists." };
    expect(firstIssue(detailsStepSchema, v)).toBe("PO number KS-1 already exists.");
  });
  it("products needs a line and vendor needs a selection", () => {
    expect(firstIssue(productsStepSchema, { lines: [] })).toBe("Add at least one product");
    expect(firstIssue(productsStepSchema, { lines: [line()] })).toBe(true);
    expect(firstIssue(vendorStepSchema, { vendorId: "" })).toBe("Select a vendor");
    expect(firstIssue(vendorStepSchema, { vendorId: "v1" })).toBe(true);
  });
});

describe("Change Purchase Order Status pills", () => {
  it("marks the current status and disables the transitions the machine forbids", () => {
    const allowed = ["Started", "Completed", "Cancelled"];
    expect(statusOptionReason("Pending", "Pending", allowed)).toBe("This is the current status.");
    expect(statusOptionReason("Pending", "Started", allowed)).toBeNull();
    expect(statusOptionReason("Started", "Pending", ["Completed", "Cancelled"])).toBe("A started purchase order can't go back to Pending.");
    expect(statusOptionReason("Completed", "Cancelled", [])).toBe("A completed purchase order can't move to Cancelled.");
  });
  it("treats Receiving as Started (the user can't pick Started again)", () => {
    expect(statusOptionReason("Receiving", "Started", ["Started", "Completed", "Cancelled"])).toBe("This is the current status.");
  });
});

describe("lines CSV export", () => {
  it("writes the header and one escaped row per line with open qty and day-only dates", () => {
    const csv = linesCsv([line()]);
    const [head, row] = csv.split("\r\n");
    expect(head).toBe(LINE_CSV_HEADERS.join(","));
    expect(row).toBe('MLT-WIDGET-01,"Widget, blue",123,Each,12,3.25,39.00,5,7,MLT1-RECV,,2027-05-01,,,,"say ""hi"""');
  });
  it("never reports negative open qty on an over-received line", () => {
    expect(linesCsv([line({ receivedQuantity: 15 })]).split("\r\n")[1]).toContain(",15,0,");
  });
});

describe("manual status stamps", () => {
  const now = "2026-11-09T12:00:00.000Z";
  it("Completed stamps completed and actual receiving at the moment of completion", () => {
    expect(statusChangeStamps({ status: "Started", receivedAt: null }, "Completed", now)).toEqual({ completedAt: now, receivedAt: now });
    expect(statusChangeStamps({ status: "Started", receivedAt: "2026-11-01T00:00:00.000Z" }, "Completed", now)).toEqual({ completedAt: now, receivedAt: now });
  });
  it("Cancelled stamps cancelled", () => {
    expect(statusChangeStamps({ status: "Pending", receivedAt: null }, "Cancelled", now)).toEqual({ cancelledAt: now });
  });
  it("re-opening a Completed order clears completed and actual receiving (Logiwa parity)", () => {
    expect(statusChangeStamps({ status: "Completed", receivedAt: now }, "Started", now)).toEqual({ completedAt: null, receivedAt: null });
  });
  it("Pending -> Started stamps nothing", () => {
    expect(statusChangeStamps({ status: "Pending", receivedAt: null }, "Started", now)).toEqual({});
  });
});
