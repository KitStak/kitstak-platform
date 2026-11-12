import { describe, expect, it } from "vitest";
import { fefoOrder, suggestSource } from "@/lib/grid-defs/work-orders/source-suggest";

const b = (id: string, freeQty: number, expiryDate: string | null = null, productionDate: string | null = null) => ({ id, freeQty, expiryDate, productionDate });

describe("suggestSource (FEFO/FIFO)", () => {
  it("prefers the earliest expiry that covers the need", () => {
    const got = suggestSource([b("late", 500, "2027-05-01"), b("early-small", 5, "2026-12-01"), b("early", 50, "2027-01-01")], 20);
    expect(got?.id).toBe("early");
  });
  it("puts no-expiry stock last and keeps FIFO order otherwise", () => {
    expect(fefoOrder([b("a", 1), b("b", 1, "2027-01-01"), b("c", 1)]).map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
  it("skips empty buckets and falls back to the largest when nothing covers", () => {
    expect(suggestSource([b("z", 0, "2026-01-01"), b("s", 3), b("m", 7)], 10)?.id).toBe("m");
    expect(suggestSource([b("z", 0)], 1)).toBeNull();
  });
});
