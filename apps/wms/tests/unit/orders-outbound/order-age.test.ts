import { describe, expect, it } from "vitest";
import { formatAge } from "@/components/orders/orders-columns";

describe("formatAge", () => {
  const now = Date.parse("2026-11-09T12:00:00Z");
  it("shows whole days with a unit", () => expect(formatAge(3, "2026-11-06T00:00:00Z", now)).toBe("3 d"));
  it("shows hours while under a day old", () => expect(formatAge(0, "2026-11-09T07:30:00Z", now)).toBe("4 h"));
  it("falls back to 0 d without an order date", () => expect(formatAge(0, null, now)).toBe("0 d"));
  it("returns null for missing values", () => expect(formatAge(null, null, now)).toBeNull());
  it("stops a closed order's hour count at its ship time", () =>
    expect(formatAge(0, "2026-11-08T00:00:00Z", Date.parse("2026-11-09T12:00:00Z"), "2026-11-08T05:30:00Z")).toBe("5 h"));
  it("ignores an unparseable until", () => expect(formatAge(0, "2026-11-09T10:00:00Z", Date.parse("2026-11-09T12:00:00Z"), "nope")).toBe("2 h"));
});
