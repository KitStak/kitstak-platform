import { describe, expect, it } from "vitest";
import { bulkResultTitle, eligibility, shipConfirmText, type EligibilityRow } from "@/components/orders/bulk/order-eligibility";

const row = (over: Partial<EligibilityRow>): EligibilityRow => ({
  id: "1", code: "SO1", status: "Open", jobId: null, retailerId: null, isMerged: false, hasLabel: false, hasActiveTask: false, hasSerials: false, ...over,
});

describe("bulk result window title (Logiwa Ship Order parity)", () => {
  it("names the partial failure the way Logiwa does", () => {
    expect(bulkResultTitle("shipped", 1, 1)).toBe("Some orders couldn’t be shipped");
  });
  it("reports a full failure and a full success distinctly", () => {
    expect(bulkResultTitle("shipped", 0, 2)).toBe("No orders could be shipped");
    expect(bulkResultTitle("shipped", 1, 0)).toBe("1 order shipped");
    expect(bulkResultTitle("deleted", 3, 0)).toBe("3 orders deleted");
  });
});

describe("ship eligibility", () => {
  it("is enabled when at least one Ready to Ship order is selected (server reports the rest)", () => {
    expect(eligibility.ship([row({ status: "Open" }), row({ id: "2", status: "Ready to Ship" })])).toBeNull();
  });
  it("explains why ship is disabled for Open-only selections", () => {
    expect(eligibility.ship([row({ status: "Open" })])).toMatch(/Ready to Ship/);
  });
  it("pluralises the confirm copy", () => {
    expect(shipConfirmText(1)).toMatch(/^1 order will be shipped/);
    expect(shipConfirmText(2)).toMatch(/^2 orders will be shipped/);
  });
});
