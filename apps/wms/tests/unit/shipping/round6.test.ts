import { describe, expect, it } from "vitest";
import { formatZoneDateTime, planChangeMessage, planChangeValue, reachedPlanStages } from "@/lib/grid-defs/shipping/shipment-plans";

describe("shipment plan change-log sentences (critic r4 minor)", () => {
  it("describes order list changes as added / removed", () => {
    expect(planChangeMessage("orders", "Orders", "", "SO000001, SO000002, SO000003")).toBe("Added orders SO000001, SO000002, SO000003.");
    expect(planChangeMessage("orders", "Orders", "SO1, SO2", "SO1")).toBe("Removed order SO2.");
    expect(planChangeMessage("orders", "Orders", "SO1", "SO2")).toBe("Added order SO2; removed order SO1.");
  });

  it("describes status, set, cleared and changed values in sentence case", () => {
    expect(planChangeMessage("status", "Status", "Open", "Shipped")).toBe("Status changed from Open to Shipped.");
    expect(planChangeMessage("truckPlateNumber", "Truck Plate Number", "", "TX-123")).toBe("Truck plate number set to TX-123.");
    expect(planChangeMessage("note", "Note", "Dock 4", "")).toBe("Note cleared (was Dock 4).");
    expect(planChangeMessage("carrier", "Carrier", "UPS - A", "FedEx - B")).toBe("Carrier changed from UPS - A to FedEx - B.");
  });

  it("formats ISO values in the warehouse zone with its label, leaving other values alone", () => {
    expect(formatZoneDateTime("2026-11-10T11:36:08.397Z", "America/New_York")).toBe("11/10/2026 6:36 AM EST");
    expect(planChangeValue("2026-11-10T11:36:08.397Z", "America/Chicago")).toBe("11/10/2026 5:36 AM CST");
    expect(planChangeValue("SO1, SO2", "America/Chicago")).toBe("SO1, SO2");
    expect(planChangeValue("2026-11-10T11:36:08Z", "Not/AZone")).toBe("11/10/2026 11:36 AM UTC");
    const msg = planChangeMessage("loadingStartedAt", "Loading Started At", "", planChangeValue("2026-11-10T11:36:08.397Z", "America/New_York"));
    expect(msg).toBe("Loading started set to 11/10/2026 6:36 AM EST.");
  });

  it("reads reached stages from both the legacy and the stored sentence format", () => {
    const r = reachedPlanStages("Shipped", ["Status is modified. Open --> In Progress", "Status changed from In Progress to Shipped."]);
    expect([...r].sort()).toEqual(["In Progress", "Open", "Shipped"]);
    expect(reachedPlanStages("Shipped", ["Status changed from Open to Shipped."]).has("Loading Started")).toBe(false);
  });
});
