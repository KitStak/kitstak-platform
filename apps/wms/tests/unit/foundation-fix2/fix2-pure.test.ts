import { describe, expect, it } from "vitest";
import { codeNameLabel } from "@/lib/utils";
import { contextLabel } from "@/lib/context-label";
import { shiftWindow, parseClock } from "@/lib/shift";
import { statusTone, TONES } from "@/lib/status-colors";
import { buildUrl } from "@/lib/use-url-state";
import { hitRank, listSearchHref } from "@/server/search/types";
import { orderSearchSections, pageRank, seeAllLabel } from "@/components/layout/search-utils";
import { bulkDisabledReason } from "@/components/grid/bulk-actions";
import { deniedPath } from "@/components/layout/status-screen";
import { defaultPrinterWarehouse, orderPrinterWarehouses } from "@/components/layout/printers-popover";
import { pickActiveSection } from "@/app/(app)/dev/ui/_components/showcase-nav";

describe("codeNameLabel", () => {
  it("treats the code as a whole leading token only", () => {
    expect(codeNameLabel("NOVA", "NovaForge Electronics")).toBe("NOVA - NovaForge Electronics");
    expect(codeNameLabel("NVF", "NovaForge Electronics")).toBe("NVF - NovaForge Electronics");
    expect(codeNameLabel("MLT1", "MLT1 - Main Fulfillment")).toBe("MLT1 - Main Fulfillment");
    expect(codeNameLabel("MLT1", "mlt1 Main")).toBe("mlt1 Main");
    expect(codeNameLabel("A.B", "AxB Co")).toBe("A.B - AxB Co");
  });
});

describe("contextLabel", () => {
  it("returns a short summary, a tooltip description and a chip label", () => {
    const label = contextLabel({ warehouse: { code: "MLT1", name: "Main Fulfillment" }, client: null });
    expect(label).toEqual({
      summary: "MLT1 · All",
      compact: "MLT1",
      description: "Warehouse: MLT1 - Main Fulfillment · Client: All clients",
      long: "MLT1 - Main Fulfillment · All clients",
    });
    expect(contextLabel({ warehouse: null, client: { code: "APX", name: "Apex" } }).summary).toBe("All WH · APX");
    expect(contextLabel({ warehouse: null, client: { code: "APX", name: "Apex" } }).compact).toBe("All WH · APX");
    // Seeded warehouse names already carry the code: never "MLT1 - MLT1 - …".
    expect(contextLabel({ warehouse: { code: "MLT1", name: "MLT1 - Main Fulfillment" }, client: null }).long).toBe("MLT1 - Main Fulfillment · All clients");
  });
});

describe("shiftWindow", () => {
  const base = { timeZone: "America/Chicago", start: "08:00", end: "17:00" } as const;
  it("reports the phase on the warehouse clock", () => {
    // 2026-11-06T05:42Z is 23:42 on Nov 5 in Chicago (CST, UTC-6): the shift has ended.
    const late = shiftWindow({ ...base, now: new Date("2026-11-06T05:42:00Z") });
    expect(late).toMatchObject({ phase: "ended", percent: 100, nowLabel: "23:42", statusLabel: "Shift ended 17:00", dateLabel: "Thu, Nov 5" });
    const mid = shiftWindow({ ...base, now: new Date("2026-11-05T18:45:00Z") });
    expect(mid).toMatchObject({ phase: "during", nowLabel: "12:45", statusLabel: "12:45 – 17:00", percent: 53 });
    const early = shiftWindow({ ...base, now: new Date("2026-11-05T12:00:00Z") });
    expect(early).toMatchObject({ phase: "before", percent: 0, statusLabel: "Starts 08:00" });
  });
  it("falls back safely on bad input", () => {
    expect(parseClock("25:00")).toBeNull();
    expect(shiftWindow({ now: new Date("2026-11-05T18:45:00Z"), timeZone: "Not/AZone", start: "x", end: "y" }).phase).toBe("ended");
  });
});

describe("status pill semantics", () => {
  it("uses the Logiwa shipment-order palette: every in-process status blue (orders REQ-R2-1)", () => {
    expect(statusTone("Ready To Pick", "shipmentOrder")).toEqual(TONES.blue);
    expect(statusTone("Picking Started", "shipmentOrder")).toEqual(TONES.blue);
    expect(statusTone("Loading Started", "shipmentOrder")).toEqual(TONES.blue);
    expect(statusTone("Ready to Ship", "shipmentOrder")).toEqual(TONES.purple);
    expect(statusTone("Urgent", "priority")).toEqual(statusTone("High", "priority"));
  });
});

describe("buildUrl", () => {
  it("keeps the hash and drops an empty query", () => {
    expect(buildUrl("/dev/ui", new URLSearchParams("q=SO01"), "#grid")).toBe("/dev/ui?q=SO01#grid");
    expect(buildUrl("/dev/ui", new URLSearchParams(), "")).toBe("/dev/ui");
  });
});

describe("search ranking", () => {
  it("ranks exact, prefix, contains, then other fields", () => {
    expect(hitRank("apx", ["APX", "Apex"])).toBe(0);
    expect(hitRank("job0052", ["Job005259"])).toBe(1);
    expect(hitRank("005259", ["Job005259"])).toBe(2);
    expect(hitRank("apex", ["SO010001", null])).toBe(3);
    expect(listSearchHref("/orders", "a b")).toBe("/orders?q=a+b");
  });

  it("orders sections by best rank with Pages first on ties", () => {
    const groups = [
      { key: "orders", bestRank: 3 },
      { key: "clients", bestRank: 1 },
    ];
    expect(orderSearchSections(2, groups)).toEqual([groups[1], "pages", groups[0]]);
    expect(orderSearchSections(null, groups)).toEqual([groups[1], groups[0]]);
    expect(orderSearchSections(1, [{ key: "jobs", bestRank: 1 }])).toEqual(["pages", { key: "jobs", bestRank: 1 }]);
    expect(pageRank([{ label: "Shipment Orders", href: "/orders", trail: "" }], "shipment orders")).toBe(0);
    expect(pageRank([{ label: "Shipment Orders", href: "/orders", trail: "" }], "orders")).toBe(2);
    expect(seeAllLabel(1234, "Orders")).toBe("See all 1,234 orders");
    expect(seeAllLabel(1, "Clients")).toBe("View in Clients");
  });
});

describe("bulk action eligibility", () => {
  const action = { key: "cancel", label: "Cancel", onSelect: () => undefined, eligibility: (ids: readonly string[]) => (ids.includes("shipped") ? "Shipped orders can't be cancelled" : null) };
  it("evaluates the selection", () => {
    expect(bulkDisabledReason(action, [], "order")).toBe("Select at least one order");
    expect(bulkDisabledReason(action, ["open"])).toBeNull();
    expect(bulkDisabledReason(action, ["open", "shipped"])).toBe("Shipped orders can't be cancelled");
    expect(bulkDisabledReason(action, 2)).toBeNull();
  });
});

describe("status pages", () => {
  it("only echoes safe app paths", () => {
    expect(deniedPath("/settings/users?x=1")).toBe("/settings/users");
    expect(deniedPath("//evil.example")).toBeNull();
    expect(deniedPath("https://evil.example")).toBeNull();
    expect(deniedPath(undefined)).toBeNull();
  });
});

describe("printers warehouse defaults", () => {
  const rows = [
    { warehouseId: "ks2", warehouseCode: "KS2" },
    { warehouseId: "mlt1", warehouseCode: "MLT1" },
    { warehouseId: "abc", warehouseCode: "ABC" },
  ];
  it("lists the context warehouse first, then by code, and opens on it", () => {
    expect(orderPrinterWarehouses(rows, "mlt1").map((r) => r.warehouseCode)).toEqual(["MLT1", "ABC", "KS2"]);
    expect(orderPrinterWarehouses(rows, null).map((r) => r.warehouseCode)).toEqual(["ABC", "KS2", "MLT1"]);
    expect(defaultPrinterWarehouse(rows, null, "mlt1")).toBe("mlt1");
    expect(defaultPrinterWarehouse(rows, "ks2", "mlt1")).toBe("ks2");
    expect(defaultPrinterWarehouse(rows, null, "gone")).toBeNull();
    expect(defaultPrinterWarehouse([rows[0]!], null, null)).toBe("ks2");
  });
});

describe("showcase scroll-spy", () => {
  it("picks the last section scrolled past the header line", () => {
    expect(pickActiveSection([{ key: "display", top: -900 }, { key: "inputs", top: -20 }, { key: "overlays", top: 400 }])).toBe("inputs");
    expect(pickActiveSection([{ key: "display", top: 100 }, { key: "inputs", top: 900 }])).toBe("display");
    expect(pickActiveSection([{ key: "grid", top: 72 }, { key: "display", top: -5000 }])).toBe("grid");
  });
});
