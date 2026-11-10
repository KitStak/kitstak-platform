/** Mobile cart cell list: suggestion sequence + colour cycle (Logiwa parity, round 1 parity loop). */
import { describe, expect, it } from "vitest";
import { buildCells, CELL_COLORS, cellColor, cellSequence } from "@/lib/grid-defs/facility/mobile-carts";

describe("cell suggestion sequence", () => {
  it("is 1-based, level-major then column", () => {
    const cells = buildCells("MC-01", 4, 6);
    expect(cells.map((c) => cellSequence(c.level, c.column, 6))).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(cellSequence(2, 1, 6)).toBe(7);
  });
});

describe("cell colour cycle", () => {
  it("cycles Orange, Green, Red, Blue, Pink, Light Blue, Purple", () => {
    expect(CELL_COLORS.map((c) => c.name)).toEqual(["Orange", "Green", "Red", "Blue", "Pink", "Light Blue", "Purple"]);
    expect(cellColor(1).name).toBe("Orange");
    expect(cellColor(7).name).toBe("Purple");
    expect(cellColor(8).name).toBe("Orange");
    expect(cellColor(0).name).toBe("Orange");
  });
});
