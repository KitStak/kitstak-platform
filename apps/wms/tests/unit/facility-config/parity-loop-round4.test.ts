import { describe, expect, it } from "vitest";
import { pickDefaultWarehouse } from "@/components/facility/facility-shared";
import { cartDimensionText } from "@/components/facility/mobile-carts/mobile-cart-wizard";

describe("pickDefaultWarehouse (critic R3: wizard warehouse default)", () => {
  const ids = ["crit", "ks2", "mlt1"];
  it("prefers the header working context", () => expect(pickDefaultWarehouse(ids, "ks2", "mlt1")).toBe("ks2"));
  it("falls back to the user's preferred warehouse, never the first option", () => expect(pickDefaultWarehouse(ids, null, "mlt1")).toBe("mlt1"));
  it("ignores out-of-scope values", () => expect(pickDefaultWarehouse(ids, "x", "y")).toBeNull());
  it("uses the only warehouse in scope", () => expect(pickDefaultWarehouse(["a"], null, null)).toBe("a"));
});

describe("cartDimensionText", () => {
  it("formats H x L x W with unit", () => expect(cartDimensionText({ height: 60, length: 30, width: 20, dimensionUnit: "in" }, "")).toBe("60 × 30 × 20 in"));
  it("reads cell dims", () => expect(cartDimensionText({ cellHeight: 10, cellLength: 8, cellWidth: 6 }, "cell")).toBe("10 × 8 × 6"));
  it("returns null without dims", () => expect(cartDimensionText({ levels: 4 }, "")).toBeNull());
});
