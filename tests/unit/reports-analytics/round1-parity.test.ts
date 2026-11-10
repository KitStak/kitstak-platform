/** M13 Round 1 (parity loop): quadrant outlier cap, Change Log line subject + readable message. */
import { describe, expect, it } from "vitest";
import { isAboveCap, scatterYCap } from "@/components/analytics/scatter-scale";
import { lineSubject, presentMessage } from "@/server/repositories/reports-logs";
import { CHANGE_LOG_DEF } from "@/lib/grid-defs/reports/logs";
import { sortableOf } from "@/lib/grid-defs/reports/types";

describe("Performance Quadrant Y cap", () => {
  it("leaves a normal spread on auto scale", () => {
    expect(scatterYCap([12, 10, 8, 9], 9.5).cap).toBeNull();
    expect(scatterYCap([200, 10], 105).cap).toBeNull(); // too few points to call an outlier
  });

  it("caps a single runaway speed so the team is readable, and flags it as off scale", () => {
    const { cap } = scatterYCap([195, 10.4, 10, 5], 10.2);
    expect(cap).not.toBeNull();
    expect(cap as number).toBeGreaterThanOrEqual(15.6);
    expect(cap as number).toBeLessThan(195);
    expect(isAboveCap(195, cap)).toBe(true);
    expect(isAboveCap(10.4, cap)).toBe(false);
  });

  it("ignores non-finite and negative values", () => {
    expect(scatterYCap([Number.NaN, -1, 3], 3).cap).toBeNull();
  });
});

describe("Change Log presentation", () => {
  it("pulls the SKU subject out of line messages", () => {
    expect(lineSubject("APX-TEE-NVY-M -> Quantity is modified. 0 --> 1")).toBe("APX-TEE-NVY-M");
    expect(lineSubject("Status is modified. Open --> Ready to Pick")).toBeNull();
    expect(lineSubject(null)).toBeNull();
  });

  it("renders messages with arrows, ids as names, no raw i18n keys and an explicit empty side", () => {
    const names = new Map([["3f1b2c4d-0000-4000-8000-000000000001", "Job005260"]]);
    expect(presentMessage("Status is modified. Open --> Ready to Pick", names)).toBe("Status is modified. Open → Ready to Pick");
    expect(presentMessage("Job is modified.  --> 3f1b2c4d-0000-4000-8000-000000000001", names)).toBe("Job is modified. (empty) → Job005260");
    expect(presentMessage("Logiwa.NameKey.RemainingVolume is modified. 1 --> 2", names)).toBe("Remaining Volume is modified. 1 → 2");
    expect(presentMessage("", names)).toBeNull();
  });

  it("shows the message as a visible, unsortable column (round 4: readable by default)", () => {
    const message = CHANGE_LOG_DEF.columns.find((c) => c.id === "message");
    expect(message?.defaultHidden).toBeUndefined();
    expect(sortableOf(CHANGE_LOG_DEF)).not.toContain("message");
  });
});
