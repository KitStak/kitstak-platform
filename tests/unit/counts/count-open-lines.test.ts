import { describe, expect, it } from "vitest";
import { planOpenLinesReason } from "@/lib/grid-defs/counts/count-math";

describe("planOpenLinesReason", () => {
  it("allows Update Inv. when no line is still counting", () => {
    expect(planOpenLinesReason(0, 5)).toBeNull();
  });
  it("blocks while lines are still being counted and points to line-level posting", () => {
    expect(planOpenLinesReason(2, 5)).toMatch(/2 of 5 lines are still being counted/);
    expect(planOpenLinesReason(2, 5)).toMatch(/completed lines on the Lines tab/);
  });
  it("uses singular wording", () => {
    expect(planOpenLinesReason(1, 2)).toMatch(/completed line on the Lines tab and update it/);
  });
});
