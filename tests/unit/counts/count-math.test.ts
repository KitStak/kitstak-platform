/** M07 pure count rules: % Difference, plan status roll-up, action guards and lock release. */
import { describe, expect, it } from "vitest";
import {
  firstReason, formatDifference, impliedPlanStatus, lineCancelReason, lineDeleteReason, lineHoldsLock, lineRecountReason,
  countedValueError, parseCountedText, lineUpdateInvReason, parseJobRefs, percentDifference, planCancelReason, planCreateJobReason, planDeleteReason, planEditReason, planUpdateInvReason,
} from "@/lib/grid-defs/counts/count-math";

describe("percentDifference", () => {
  it("returns −10.00 for 18 counted vs 20 system", () => {
    expect(percentDifference(20, 18)).toBe(-10);
    expect(formatDifference(percentDifference(20, 18))).toBe("−10.00");
  });
  it("handles zero system stock and uncounted lines", () => {
    expect(percentDifference(0, 0)).toBe(0);
    expect(percentDifference(0, 4)).toBe(100);
    expect(percentDifference(5, null)).toBeNull();
    expect(formatDifference(null)).toBe("—");
    expect(formatDifference(2.5)).toBe("+2.50");
    expect(formatDifference(0)).toBe("0.00");
  });
  it("rounds to 2 dp", () => {
    expect(percentDifference(3, 2)).toBe(-33.33);
  });
});

describe("impliedPlanStatus", () => {
  it("keeps Pending unless every line is cancelled", () => {
    expect(impliedPlanStatus("Pending", ["Pending", "Cancelled"])).toBeNull();
    expect(impliedPlanStatus("Pending", ["Cancelled", "Cancelled"])).toBe("Cancelled");
  });
  it("rolls up started plans from their lines", () => {
    expect(impliedPlanStatus("Ready To Count", ["Ready To Count", "Ready To Count"])).toBe("Ready To Count");
    expect(impliedPlanStatus("Ready To Count", ["Ready To Count", "Count Completed"])).toBe("Count Started");
    expect(impliedPlanStatus("Count Started", ["Count Completed", "Recount Created", "Inventory Updated"])).toBe("Count Completed");
    expect(impliedPlanStatus("Count Completed", ["Inventory Updated", "Recount Created", "Cancelled"])).toBe("Inventory Updated");
    expect(impliedPlanStatus("Count Started", ["Cancelled"])).toBe("Cancelled");
    // A recount whose job was cancelled leaves only the superseded line: nothing posted, so Cancelled.
    expect(impliedPlanStatus("Count Started", ["Recount Created", "Cancelled"])).toBe("Cancelled");
  });
  it("never moves terminal plans", () => {
    expect(impliedPlanStatus("Inventory Updated", ["Count Completed"])).toBeNull();
    expect(impliedPlanStatus("Cancelled", ["Ready To Count"])).toBeNull();
  });
});

describe("action guards", () => {
  it("guards plan actions by status", () => {
    expect(planCancelReason("Pending")).toBeNull();
    expect(planCancelReason("Ready To Count")).toBeNull();
    expect(planCancelReason("Inventory Updated")).toMatch(/already been updated/);
    expect(planCreateJobReason("Pending")).toBeNull();
    expect(planCreateJobReason("Ready To Count")).not.toBeNull();
    expect(planUpdateInvReason("Count Completed", 1)).toBeNull();
    expect(planUpdateInvReason("Count Completed", 0)).toMatch(/No counted lines/);
    // Logiwa parity: open plans can Update Inv. (uncounted lines are cancelled in the confirm).
    expect(planUpdateInvReason("Pending", 0)).toMatch(/Nothing is counted yet/);
    expect(planUpdateInvReason("Ready To Count", 0)).toMatch(/Nothing is counted yet/);
    expect(planUpdateInvReason("Count Started", 0)).toMatch(/Nothing is counted yet/);
    expect(planUpdateInvReason("Count Started", 2)).toBeNull();
    expect(planUpdateInvReason("Inventory Updated", 3)).toMatch(/already been updated/);
    expect(planEditReason("Pending")).toBeNull();
    expect(planEditReason("Count Started")).not.toBeNull();
    expect(planDeleteReason("Pending")).toBeNull();
    expect(planDeleteReason("Cancelled")).not.toBeNull();
  });
  it("guards line actions by status", () => {
    expect(lineCancelReason("Ready To Count")).toBeNull();
    expect(lineCancelReason("Count Completed")).toBeNull(); // round 6: counted lines can be cancelled (with a reason)
    expect(lineCancelReason("Inventory Updated")).toMatch(/can't be cancelled/);
    expect(lineUpdateInvReason("Count Completed")).toBeNull();
    expect(lineUpdateInvReason("Inventory Updated")).toMatch(/already/);
    expect(lineRecountReason("Count Completed")).toBeNull();
    expect(lineRecountReason("Recount Created")).toMatch(/already exists/);
    expect(lineRecountReason("Count Completed", "Cycle Count")).toBeNull();
    expect(lineRecountReason("Count Completed", "Instant Count")).toMatch(/Cycle Count plans/);
    expect(lineRecountReason("Count Started", "Cycle Count")).toMatch(/Only counted/);
    expect(lineDeleteReason("Pending")).toBeNull();
    expect(lineDeleteReason("Ready To Count")).not.toBeNull();
  });
  it("returns the first failing reason of a selection", () => {
    expect(firstReason(["Pending", "Cancelled"], planDeleteReason)).not.toBeNull();
    expect(firstReason(["Pending", "Pending"], planDeleteReason)).toBeNull();
    expect(firstReason([], planDeleteReason)).toBeNull();
  });
});

describe("parseJobRefs", () => {
  it("parses id|code pairs and drops malformed ones", () => {
    expect(parseJobRefs("a1|Job001;b2|Job002")).toEqual([{ id: "a1", code: "Job001" }, { id: "b2", code: "Job002" }]);
    expect(parseJobRefs("bad;|x;y|")).toEqual([]);
    expect(parseJobRefs(null)).toEqual([]);
  });
});

describe("lineHoldsLock", () => {
  it("holds while the plan and line are open", () => {
    expect(lineHoldsLock(true, "Count Started", "Ready To Count")).toBe(true);
    expect(lineHoldsLock(true, "Count Completed", "Count Completed")).toBe(true);
  });
  it("releases on posted, recounted or cancelled lines and closed plans", () => {
    expect(lineHoldsLock(true, "Count Completed", "Inventory Updated")).toBe(false);
    expect(lineHoldsLock(true, "Count Started", "Recount Created")).toBe(false);
    expect(lineHoldsLock(true, "Cancelled", "Cancelled")).toBe(false);
    expect(lineHoldsLock(false, "Pending", "Pending")).toBe(false);
  });
});

describe("countedValueError (Count Sheet inline validation)", () => {
  it("accepts blanks, zero and whole numbers", () => {
    expect(countedValueError(null)).toBeNull();
    expect(countedValueError(0)).toBeNull();
    expect(countedValueError(17)).toBeNull();
  });
  it("rejects negatives and fractions", () => {
    expect(countedValueError(-3)).toMatch(/negative/);
    expect(countedValueError(2.5)).toMatch(/whole/);
    expect(countedValueError(Number.NaN)).toMatch(/whole number/);
    expect(parseCountedText("-3")).toBe(-3);
    expect(parseCountedText(" 1,250 ")).toBe(1250);
    expect(parseCountedText("2.5")).toBe(2.5);
    expect(Number.isNaN(parseCountedText("abc"))).toBe(true);
    expect(parseCountedText("")).toBeNull();
  });
});
