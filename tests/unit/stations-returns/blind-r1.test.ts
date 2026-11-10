import { describe, expect, it } from "vitest";
import { retailerLabelSchema, toRetailerSpec } from "@/server/print/templates/barcode-label";
import { renderPrint } from "@/server/print";
import { isHospitalLocation } from "@/server/repositories/packing-hospitals";
import { editReturnInfoSchema } from "@/server/repositories/returns";
import { dispositionTargets } from "@/components/returns/return-rules-card";
import { initialReturnInfo } from "@/components/returns/edit-return-info-modal";
import { checkReturnLine, DEFAULT_RETURN_RULES } from "@/lib/grid-defs/admin/return-rules";

describe("retailer label", () => {
  it("accepts just an order code (bulk menu) and a full station record", () => {
    expect(retailerLabelSchema.safeParse({ orderCode: "SO1" }).success).toBe(true);
    const spec = toRetailerSpec(retailerLabelSchema.parse({ orderCode: "SO1", retailerName: "Target", retailerPo: "PO9", caseNumber: 2, caseCount: 3, clientName: "Apex" }));
    expect(spec.title).toBe("Target");
    expect(spec.subtitle).toBe("PO PO9");
    expect(spec.details.join(" ")).toContain("Case 2 of 3");
    expect(spec.barcode).toBe("SO1");
  });
  it("renders a PDF for retailer-case-label (was 'not configured')", async () => {
    const out = await renderPrint({ typeKey: "retailer-case-label", records: [{ orderCode: "SO1", caseNumber: 1, caseCount: 1 }] });
    expect(out.mime).toBe("application/pdf");
    expect(out.bytes.length).toBeGreaterThan(500);
  });
});

describe("hospital locations", () => {
  it("only explicitly designated locations are hospitals (HOSP* code or Hospital group), never Returns bins", () => {
    expect(isHospitalLocation({ code: "HOSP-01", locationType: "Shelves" })).toBe(true);
    expect(isHospitalLocation({ code: "RET-01", locationType: "Shelves" })).toBe(false);
    expect(isHospitalLocation({ code: "Z-9", locationType: "Bins", groupName: " hospital " })).toBe(true);
    expect(isHospitalLocation({ code: "HOSP-V", locationType: "Virtual" })).toBe(false);
    expect(isHospitalLocation({ code: "HOSP-02", locationType: "Shelves", isActive: false })).toBe(false);
    expect(isHospitalLocation({ code: "A-01", locationType: "Shelves" })).toBe(false);
  });
});

describe("per-RMA return info", () => {
  it("validates several tracking numbers, unique, max 10", () => {
    const base = { carrierCode: "UPS", carrierServiceName: "Ground", shippingCost: 7.5 };
    expect(editReturnInfoSchema.safeParse({ ...base, trackingNumbers: ["1Z1", "1Z2"] }).success).toBe(true);
    expect(editReturnInfoSchema.safeParse({ ...base, trackingNumbers: ["1Z1", "1z1"] }).success).toBe(false);
    expect(editReturnInfoSchema.safeParse({ ...base, trackingNumbers: Array.from({ length: 11 }, (_, i) => `T${i}`) }).success).toBe(false);
    expect(editReturnInfoSchema.safeParse({ ...base, shippingCost: -1, trackingNumbers: [] }).success).toBe(false);
  });
  it("prefills from the stored comma list", () => {
    expect(initialReturnInfo({ carrierCode: null, carrierServiceName: null, trackingNumber: "A, B", returnShippingCost: null }).trackingNumbers).toEqual(["A", "B"]);
  });
});

describe("return process at the station", () => {
  it("names where each disposition goes", () => {
    const t = dispositionTargets("RET-01", "LP-9");
    expect(t.find((x) => x.disposition === "Restock")?.where).toContain("LP-9");
    expect(t.find((x) => x.disposition === "Quarantine")?.where).toContain("RET-01");
    expect(dispositionTargets("RET-01", null)[0]?.where).toContain("RET-01");
  });
  it("rules block an unshipped SKU and over-return, and can be switched off", () => {
    const shipped = [{ productId: "p1", qty: 2 }];
    expect(checkReturnLine(DEFAULT_RETURN_RULES, shipped, { productId: "p2", qty: 1 })[0]?.rule).toBe("preventUnspecifiedSku");
    expect(checkReturnLine(DEFAULT_RETURN_RULES, shipped, { productId: "p1", qty: 2, alreadyReturned: 1 })[0]?.rule).toBe("preventExceedingShippedQty");
    expect(checkReturnLine({ ...DEFAULT_RETURN_RULES, preventExceedingShippedQty: false }, shipped, { productId: "p1", qty: 2, alreadyReturned: 1 })).toEqual([]);
  });
});
