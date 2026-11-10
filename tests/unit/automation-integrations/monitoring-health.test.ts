/** Round 2: channel health "no data" vs "failing" roll-up. */
import { describe, expect, it } from "vitest";
import { LOW_PERFORMING_PCT, successRateOf, summarizeHealth } from "@/lib/grid-defs/integrations/monitoring";

describe("successRateOf", () => {
  it("returns null when there were no calls", () => expect(successRateOf(0, 0)).toBeNull());
  it("rounds to whole percent", () => {
    expect(successRateOf(2, 1)).toBe(67);
    expect(successRateOf(0, 4)).toBe(0);
    expect(successRateOf(5, 0)).toBe(100);
  });
});

describe("summarizeHealth", () => {
  it("keeps never-called setups out of the average and the low-performing count", () => {
    expect(summarizeHealth([null, null, null])).toEqual({ setups: 3, avgSuccess: null, lowPerforming: 0, noData: 3 });
  });
  it("averages only measured setups", () => {
    const s = summarizeHealth([100, LOW_PERFORMING_PCT - 1, null]);
    expect(s).toEqual({ setups: 3, avgSuccess: Math.round((100 + LOW_PERFORMING_PCT - 1) / 2), lowPerforming: 1, noData: 1 });
  });
  it("handles an empty list", () => expect(summarizeHealth([])).toEqual({ setups: 0, avgSuccess: null, lowPerforming: 0, noData: 0 }));
});
