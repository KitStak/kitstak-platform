import { describe, expect, it } from "vitest";
import { clampShift } from "@/components/layout/mega-menu";

describe("mega-menu clampShift", () => {
  it("leaves a panel that fits untouched and pulls an overflowing one back in whole pixels", () => {
    expect(clampShift(900, 1200, 1264)).toBe(0);
    expect(clampShift(900, 1300.4, 1264)).toBe(-36);
    // Never pushed past the left gutter, even when the panel is wider than the room available.
    expect(clampShift(40, 1400, 1264)).toBe(-24);
  });

  it("settles under browser zoom, where the measured rect carries sub-pixel noise", () => {
    // Worst case for the helper: a caller that measures the already shifted panel and subtracts
    // the shift, with a quantised (float32, 110% zoom) measurement that never reproduces exactly.
    const zoom = 1.1;
    const measure = (base: number, shift: number): number => Math.fround(Math.fround((base + shift) * zoom) / zoom);
    const width = 643.3333129882812;
    const maxRight = 1137 / zoom - 16;
    let shift = 0;
    let updates = 0;
    for (let i = 0; i < 100; i++) {
      const left = measure(700.1818237304688, shift) - shift;
      const next = clampShift(left, left + width, maxRight);
      if (Math.abs(next - shift) < 1) break;
      shift = next;
      updates++;
    }
    expect(updates).toBeLessThanOrEqual(2);
    expect(Number.isInteger(shift)).toBe(true);
  });
});
