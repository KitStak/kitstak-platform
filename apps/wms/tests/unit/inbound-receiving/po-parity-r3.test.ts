/** M05 round 3: line editor total never shows a stale value for invalid input. */
import { describe, expect, it } from "vitest";
import { lineTotalOrNull } from "@/components/receiving/wizard/po-form-model";

describe("lineTotalOrNull", () => {
  it("computes a rounded total for valid input", () => {
    expect(lineTotalOrNull(3, 8.96)).toBe(26.88);
    expect(lineTotalOrNull(1, 0)).toBe(0);
  });
  it("returns null when quantity or price is missing or invalid", () => {
    expect(lineTotalOrNull(null, 8.96)).toBeNull();
    expect(lineTotalOrNull(undefined, 8.96)).toBeNull();
    expect(lineTotalOrNull(Number.NaN, 8.96)).toBeNull();
    expect(lineTotalOrNull(0, 8.96)).toBeNull();
    expect(lineTotalOrNull(1.5, 8.96)).toBeNull();
    expect(lineTotalOrNull(3, null)).toBeNull();
    expect(lineTotalOrNull(3, -1)).toBeNull();
    expect(lineTotalOrNull("3", 1)).toBeNull();
  });
});
