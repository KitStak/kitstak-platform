/** REQ-10 adapter: `/api/pickers/products` picker options mapped to PO product picks. */
import { describe, expect, it } from "vitest";
import { toProductPicks } from "@/components/receiving/wizard/po-product-search";

describe("toProductPicks", () => {
  it("maps label to SKU and prefers meta.name over sublabel", () => {
    const picks = toProductPicks([
      { id: "p1", label: "CPL-BAG-MED-12", sublabel: "Sub name", meta: { clientId: "c", name: "Copperline Morning Medium Roast — 12oz", uom: "Unit", imageUrl: "https://cdn/x.png", isKit: false } },
      { id: "p2", label: "CPL-MUG-12OZ", sublabel: "Copperline Diner Mug — 12oz" },
    ]);
    expect(picks).toEqual([
      { id: "p1", sku: "CPL-BAG-MED-12", name: "Copperline Morning Medium Roast — 12oz", imageUrl: "https://cdn/x.png" },
      { id: "p2", sku: "CPL-MUG-12OZ", name: "Copperline Diner Mug — 12oz", imageUrl: null },
    ]);
  });

  it("skips malformed rows instead of dropping the whole list", () => {
    const picks = toProductPicks([{ id: "p1", label: "SKU-1", sublabel: null }, { nope: true }, { id: 3, label: "bad" }]);
    expect(picks.map((p) => p.sku)).toEqual(["SKU-1"]);
    expect(picks[0]?.name).toBe("");
  });

  it("returns an empty list for non-array payloads", () => {
    expect(toProductPicks(undefined)).toEqual([]);
    expect(toProductPicks({ data: [] })).toEqual([]);
  });
});
