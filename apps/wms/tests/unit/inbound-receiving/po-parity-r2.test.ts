/** Round 2 parity: putaway label humanising, receive-drawer quantity gate, line CSV quoting. */
import { describe, expect, it } from "vitest";
import { linesCsv, putawayAlgorithmLabel, receiveQtyIssue, shortReason, type LineDraft } from "@/components/receiving/wizard/po-form-model";

describe("putawayAlgorithmLabel", () => {
  it("humanises system constants", () => {
    expect(putawayAlgorithmLabel("SAME_SKU_EMPTY_LOCATION_ALGORITHM")).toBe("Same SKU, empty location");
    expect(putawayAlgorithmLabel("REPLENISHMENT_ALGORITHM")).toBe("Replenishment");
    expect(putawayAlgorithmLabel("FEFO_ZONE_ALGORITHM")).toBe("FEFO zone");
  });
  it("keeps custom names and handles blanks", () => {
    expect(putawayAlgorithmLabel("Cold room first")).toBe("Cold room first");
    expect(putawayAlgorithmLabel("")).toBe("Putaway rule");
    expect(putawayAlgorithmLabel(null)).toBe("Putaway rule");
    expect(putawayAlgorithmLabel("_ALGORITHM")).toBe("Putaway rule");
  });
});

describe("shortReason", () => {
  it("shows the first reason and a count", () => {
    expect(shortReason([])).toBe("");
    expect(shortReason(["Same SKU"])).toBe("Same SKU");
    expect(shortReason(["Same SKU", "Empty", "Zone A"])).toBe("Same SKU +2 more");
  });
});

describe("receiveQtyIssue", () => {
  it("blocks negative, zero, fractional and empty quantities on included lines", () => {
    expect(receiveQtyIssue([{ include: true, quantity: -3 }])).toMatch(/at least 1/);
    expect(receiveQtyIssue([{ include: true, quantity: 0 }])).toMatch(/at least 1/);
    expect(receiveQtyIssue([{ include: true, quantity: 1.5 }])).toMatch(/at least 1/);
    expect(receiveQtyIssue([{ include: true, quantity: null }])).toMatch(/at least 1/);
  });
  it("ignores excluded lines and needs one included line", () => {
    expect(receiveQtyIssue([{ include: false, quantity: -3 }, { include: true, quantity: 2 }])).toBeNull();
    expect(receiveQtyIssue([{ include: false, quantity: 2 }])).toMatch(/Select at least one/);
  });
});

describe("linesCsv", () => {
  it("quotes commas, quotes and newlines", () => {
    const line = { sku: "A,1", productName: 'He said "hi"\nok', barcode: "", packType: "Each", uom: "Each", packTypes: [], orderedQuantity: 2, unitCost: 1.5, receivedQuantity: 0 } as unknown as LineDraft;
    const csv = linesCsv([line]);
    expect(csv).toContain('"A,1"');
    expect(csv).toContain('"He said ""hi""\nok"');
  });
});
