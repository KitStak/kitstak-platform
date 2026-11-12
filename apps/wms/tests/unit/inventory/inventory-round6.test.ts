import { describe, expect, it } from "vitest";
import { isLargeDecrease, saveLabel, signedDelta } from "@/components/inventory/quantity-drawer";
import { bucketSubLabel } from "@/components/inventory/by-location-types";

describe("adjust drawer delta + confirm", () => {
  it("computes the signed delta per mode", () => {
    expect(signedDelta("adjust", 15, 1)).toBe(-14);
    expect(signedDelta("add", 15, 3)).toBe(3);
    expect(signedDelta("remove", 15, 2)).toBe(-2);
    expect(signedDelta("adjust", 15, null)).toBeNull();
    expect(signedDelta("adjust", 15, 1.5)).toBeNull();
  });
  it("labels Save with the signed delta", () => {
    expect(saveLabel(-14)).toBe("Save (−14)");
    expect(saveLabel(3)).toBe("Save (+3)");
    expect(saveLabel(0)).toBe("Save");
    expect(saveLabel(null)).toBe("Save");
  });
  it("asks for confirmation on large decreases only", () => {
    expect(isLargeDecrease(15, -14)).toBe(true); // >25%, also >10 units
    expect(isLargeDecrease(100, -11)).toBe(true); // >10 units
    expect(isLargeDecrease(100, -10)).toBe(false);
    expect(isLargeDecrease(8, -3)).toBe(true); // 37.5%
    expect(isLargeDecrease(8, -2)).toBe(false);
    expect(isLargeDecrease(8, 5)).toBe(false);
    expect(isLargeDecrease(8, null)).toBe(false);
  });
});

describe("bucketSubLabel", () => {
  const iso = (v: string) => v.slice(0, 10);
  const base = { lotNumber: null, lpNumber: null, status: "Stock", poNumber: null, receivedAt: "2026-11-01T10:00:00Z" };
  it("names the attributes that split rows", () => {
    expect(bucketSubLabel({ ...base, lotNumber: "L1", lpNumber: "LP9", status: "Picked" }, iso)).toBe("Lot L1 · LP LP9 · Picked");
    expect(bucketSubLabel({ ...base, poNumber: "PO-7" }, iso)).toBe("PO PO-7");
  });
  it("falls back to the receiving date", () => {
    expect(bucketSubLabel(base, iso)).toBe("Rcvd 2026-11-01");
  });
});
