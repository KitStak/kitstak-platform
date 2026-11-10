import { describe, expect, it } from "vitest";
import { DIFFERENCE_TOLERANCE_PCT, differenceBand } from "@/components/counts/count-badges";
import { buildLineColumns } from "@/components/counts/counts-columns";

describe("blind round 3: % Difference thresholds and column order", () => {
  it("bands differences by the ±5 % tolerance", () => {
    expect(differenceBand(0)).toBe("none");
    expect(differenceBand(DIFFERENCE_TOLERANCE_PCT)).toBe("minor");
    expect(differenceBand(-3.2)).toBe("minor");
    expect(differenceBand(-5.01)).toBe("short");
    expect(differenceBand(12)).toBe("over");
  });
  it.each(["locations", "skus"] as const)("%s grid shows Approved Stock, Approved Count and %% Difference side by side", (kind) => {
    const ids = buildLineColumns(kind).map((c) => c.id);
    const i = ids.indexOf("approvedStockQty");
    expect(ids.slice(i, i + 3)).toEqual(["approvedStockQty", "approvedCountQty", "difference"]);
  });
});
