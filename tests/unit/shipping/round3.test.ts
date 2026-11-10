/** Round 3 parity fixes: lifecycle-time corrections, gate search merge, EOD print formats, export-selected CSV. */
import { describe, expect, it } from "vitest";
import { editableLifecycleTimes, mergeLifecycleTimes } from "@/lib/grid-defs/shipping/shipment-plans";
import { formatShipDay, formatWarehouseDateTime } from "@/server/repositories/end-of-day-report";
import { mergeGateResults } from "@/components/shipment-plans/plan-form-controls";
import { selectedRowsCsv } from "@/components/shipment-plans/plan-subgrids";
import { headerMinWidth } from "@/components/shipping/column-kit";

const NOW = new Date("2026-11-10T15:00:00.000Z");
const none = { loadingStartedAt: null, loadingCompletedAt: null, truckDepartedAt: null, actualShipmentAt: null };

describe("lifecycle time corrections", () => {
  it("opens times by stage; actual shipment is never manual", () => {
    expect([...editableLifecycleTimes("Open")]).toEqual([]);
    expect([...editableLifecycleTimes("Loading Started")]).toEqual(["loadingStartedAt"]);
    expect([...editableLifecycleTimes("Loading Completed")].sort()).toEqual(["loadingCompletedAt", "loadingStartedAt", "truckDepartedAt"]);
    expect(editableLifecycleTimes("Shipped").has("actualShipmentAt")).toBe(false);
  });

  it("keeps stored values for stages not reached and applies allowed corrections", () => {
    const stored = { ...none, loadingStartedAt: "2026-11-10T14:00:00.000Z" };
    const r = mergeLifecycleTimes("Loading Started", stored, { loadingStartedAt: "2026-11-10T13:30:00.000Z", truckDepartedAt: "2026-11-10T14:30:00.000Z", actualShipmentAt: "2026-11-10T14:40:00.000Z" }, NOW);
    expect(r.error).toBeNull();
    expect(r.values).toEqual({ ...none, loadingStartedAt: "2026-11-10T13:30:00.000Z" });
  });

  it("rejects clearing, future times and out-of-order stages", () => {
    const stored = { ...none, loadingStartedAt: "2026-11-10T14:00:00.000Z", loadingCompletedAt: "2026-11-10T14:20:00.000Z" };
    expect(mergeLifecycleTimes("Loading Completed", stored, { loadingStartedAt: null }, NOW).error?.message).toMatch(/can't be cleared/);
    expect(mergeLifecycleTimes("Loading Completed", stored, { truckDepartedAt: "2026-11-11T09:00:00.000Z" }, NOW).error?.message).toMatch(/future/);
    const bad = mergeLifecycleTimes("Loading Completed", stored, { truckDepartedAt: "2026-11-10T14:10:00.000Z" }, NOW);
    expect(bad.error).toEqual({ field: "truckDepartedAt", message: "The truck can't depart before loading completed" });
    expect(mergeLifecycleTimes("Loading Completed", stored, { truckDepartedAt: "2026-11-10T14:45:00.000Z" }, NOW).values.truckDepartedAt).toBe("2026-11-10T14:45:00.000Z");
  });
});

describe("loading gate search", () => {
  it("merges Loading and Shipment results once each, sorted naturally", () => {
    const merged = mergeGateResults([
      [{ id: "b", label: "LOAD-02" }, { id: "a", label: "LOAD-01" }],
      [{ id: "c", label: "SHIP-10" }, { id: "d", label: "SHIP-2" }, { id: "a", label: "LOAD-01" }],
    ]);
    expect(merged.map((o) => o.label)).toEqual(["LOAD-01", "LOAD-02", "SHIP-2", "SHIP-10"]);
  });
});

describe("EOD report formats", () => {
  it("prints the ship day zero-padded and times in the warehouse zone with its name", () => {
    expect(formatShipDay("2026-11-03")).toBe("11/03/2026");
    // 03:56Z is 9:56 PM the previous day in Chicago (the grid's value), not 3:56 AM.
    expect(formatWarehouseDateTime("2026-11-10T03:56:00.000Z", "America/Chicago")).toBe("11/09/2026 9:56 PM CST");
    expect(formatWarehouseDateTime("2026-11-10T07:01:00.000Z", "America/New_York")).toBe("11/10/2026 2:01 AM EST");
    expect(formatWarehouseDateTime("2026-11-10T07:01:00.000Z", "Not/AZone")).toBe("11/10/2026 7:01 AM UTC");
  });
});

describe("export selected", () => {
  it("writes the selected rows in column order with CSV escaping", () => {
    const rows = [{ id: "1", planCode: "SP1", orderCode: "SO, 1", orderStatus: "Shipped" }] as never;
    expect(selectedRowsCsv(rows, [{ key: "planCode", label: "Shipment plan code" }, { key: "orderCode", label: "Order code" }])).toBe('Shipment plan code,Order code\r\nSP1,"SO, 1"');
  });

  it("sizes columns to their uppercase header", () => {
    expect(headerMinWidth("Is allow saturday delivery")).toBeGreaterThan(200);
  });
});
