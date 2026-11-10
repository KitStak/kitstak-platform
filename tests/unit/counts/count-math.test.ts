/** M07 pure count rules: % Difference, plan status roll-up, action guards and lock release. */
import { describe, expect, it } from "vitest";
import {
  firstReason, formatDifference, impliedPlanStatus, lineCancelReason, lineDeleteReason, lineHoldsLock, lineRecountReason,
  lineUpdateInvReason, percentDifference, planCancelReason, planCreateJobReason, planDeleteReason, planEditReason, planUpdateInvReason,
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
    expect(planUpdateInvReason("Count Started", 0)).toMatch(/No counted lines/);
    expect(planUpdateInvReason("Pending", 0)).toMatch(/Nothing has been counted/);
    expect(planEditReason("Pending")).toBeNull();
    expect(planEditReason("Count Started")).not.toBeNull();
    expect(planDeleteReason("Pending")).toBeNull();
    expect(planDeleteReason("Cancelled")).not.toBeNull();
  });
  it("guards line actions by status", () => {
    expect(lineCancelReason("Ready To Count")).toBeNull();
    expect(lineCancelReason("Count Completed")).toMatch(/can't be cancelled/);
    expect(lineUpdateInvReason("Count Completed")).toBeNull();
    expect(lineUpdateInvReason("Inventory Updated")).toMatch(/already/);
    expect(lineRecountReason("Count Completed")).toBeNull();
    expect(lineRecountReason("Recount Created")).toMatch(/already exists/);
    expect(lineDeleteReason("Pending")).toBeNull();
    expect(lineDeleteReason("Ready To Count")).not.toBeNull();
  });
  it("returns the first failing reason of a selection", () => {
    expect(firstReason(["Pending", "Cancelled"], planDeleteReason)).not.toBeNull();
    expect(firstReason(["Pending", "Pending"], planDeleteReason)).toBeNull();
    expect(firstReason([], planDeleteReason)).toBeNull();
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
