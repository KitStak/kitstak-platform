import { describe, expect, it } from "vitest";
import { shipResultRows, shipResultTitle, shipStatusNotes } from "@/components/shipment-plans/ship-result";
import { planStatusNote } from "@/lib/grid-defs/shipping/shipment-plans";
import type { ShipPlansResult } from "@/server/repositories/shipment-plans";

const codes = new Map([["p1", "SP1"], ["p2", "SP2"], ["p3", "SP3"]]);

describe("ship result window rows", () => {
  it("lists one row per order and plan-level failures, skipping PARTIAL summaries", () => {
    const result: ShipPlansResult = {
      succeeded: ["p1"],
      failed: [
        { id: "p2", code: "PARTIAL", message: "SP2: 1 of 2 orders shipped" },
        { id: "p3", code: "INVALID_STATE", message: "SP3: The plan has no orders to ship." },
      ],
      outcomes: [
        { planId: "p1", planCode: "SP1", planStatus: "Shipped", previousStatus: "Open", statusNote: "Plan moved from Open to Shipped: the order is shipped.", shipped: ["SO1"], failed: [], manifestWarnings: ["SO1: its package is on a closed manifest."] },
        { planId: "p2", planCode: "SP2", planStatus: "Open", previousStatus: "Open", statusNote: "Plan status stays Open: 1 of 2 orders shipped. It becomes Shipped when the rest ship.", shipped: ["SO2"], failed: [{ orderCode: "SO3", message: "The shipment order status is not valid (Open); only Ready to Ship orders can be shipped." }], manifestWarnings: [] },
      ],
    };
    const rows = shipResultRows(result, codes);
    expect(rows).toEqual([
      { planCode: "SP1", orderCode: "SO1", ok: true, description: "Shipped" },
      { planCode: "SP2", orderCode: "SO2", ok: true, description: "Shipped" },
      { planCode: "SP2", orderCode: "SO3", ok: false, description: "The shipment order status is not valid (Open); only Ready to Ship orders can be shipped" },
      { planCode: "SP3", orderCode: null, ok: false, description: "The plan has no orders to ship" },
    ]);
    expect(shipResultTitle(rows)).toBe("Some orders couldn’t be shipped");
    expect(shipStatusNotes(result)).toEqual([
      "SP1: Plan moved from Open to Shipped: the order is shipped.",
      "SP2: Plan status stays Open: 1 of 2 orders shipped. It becomes Shipped when the rest ship.",
      "SO1: its package is on a closed manifest.",
    ]);
  });

  it("explains the status a ship moved the plan to, and stays quiet when it did not move", () => {
    expect(planStatusNote("Open", "Open", 0, 2)).toBeNull();
    // A partial ship keeps the status and says so (no invented Loading Started).
    expect(planStatusNote("Open", "Open", 1, 2)).toBe("Plan status stays Open: 1 of 2 orders shipped. It becomes Shipped when the rest ship.");
    expect(planStatusNote("In Progress", "In Progress", 2, 3)).toBe("Plan status stays In Progress: 2 of 3 orders shipped. It becomes Shipped when the rest ship.");
    expect(planStatusNote("Loading Started", "Shipped", 2, 2)).toBe("Plan moved from Loading Started to Shipped: all 2 orders are shipped.");
  });

  it("titles all-success, all-error and empty results", () => {
    expect(shipResultTitle([{ planCode: "SP1", orderCode: "SO1", ok: true, description: "Shipped" }])).toBe("The order was shipped");
    expect(shipResultTitle([{ planCode: "SP1", orderCode: "SO1", ok: false, description: "x" }])).toBe("No orders could be shipped");
    expect(shipResultTitle([])).toBe("Nothing was shipped");
  });
});
