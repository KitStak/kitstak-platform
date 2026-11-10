/**
 * M02 pure guards and helpers shared by the client grids and the server: void guard, tracking
 * URLs, pending EOD ids, EOD close/reprint guards, plan eligibility/edit/delete/ship guards,
 * unit conversions and facet-driven filter fields.
 */
import { describe, expect, it } from "vitest";
import { withFacets, type ShippingField } from "@/lib/grid-defs/shipping/common";
import { closeBlockReason, parsePendingEodId, parseSplitEodId, pendingEodId, reprintBlockReason, splitEodId } from "@/lib/grid-defs/shipping/end-of-day";
import {
  in3ToFt3, orderEligibilityReason, ozToLb, PLAN_ELIGIBLE_ORDER_FIELDS, planDeleteBlockReason, planEditBlockReason, planShipBlockReason,
} from "@/lib/grid-defs/shipping/shipment-plans";
import { CARRIER_VOID_WINDOW_DAYS, trackingUrl, voidBlockReason } from "@/lib/grid-defs/shipping/shipments";

const NOW = new Date("2026-11-06T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("voidBlockReason", () => {
  it("allows an active, unshipped label inside the carrier window", () => {
    expect(voidBlockReason({ labelStatus: "Active", actualShipmentAt: null, labelCreatedAt: daysAgo(1) }, NOW)).toBeNull();
  });
  it("blocks voided, shipped and out-of-window labels with a reason", () => {
    expect(voidBlockReason({ labelStatus: "Voided", actualShipmentAt: null, labelCreatedAt: daysAgo(1) }, NOW)).toMatch(/already voided/);
    expect(voidBlockReason({ labelStatus: "Active", actualShipmentAt: daysAgo(0), labelCreatedAt: daysAgo(1) }, NOW)).toMatch(/shipped/);
    expect(voidBlockReason({ labelStatus: "Active", actualShipmentAt: null, labelCreatedAt: daysAgo(CARRIER_VOID_WINDOW_DAYS + 1) }, NOW)).toMatch(/void window/);
  });
});

describe("trackingUrl", () => {
  it("fills the carrier pattern and encodes the number", () => {
    expect(trackingUrl("UPS", "1Z 99")).toBe("https://www.ups.com/track?loc=en_US&tracknum=1Z%2099");
    expect(trackingUrl("FedEx", "123")).toContain("fedex.com");
  });
  it("returns null for unknown carriers or missing numbers", () => {
    expect(trackingUrl("ACME", "1")).toBeNull();
    expect(trackingUrl("UPS", null)).toBeNull();
  });
});

describe("pending EOD ids", () => {
  it("round-trips and rejects malformed ids", () => {
    const id = pendingEodId("wh", "conn", "2026-11-06");
    expect(parsePendingEodId(id)).toEqual({ warehouseId: "wh", connectionId: "conn", shipDate: "2026-11-06", carrierCode: null });
    expect(parsePendingEodId(pendingEodId("wh", "conn", "2026-11-06", "USPS"))).toMatchObject({ carrierCode: "USPS" });
    expect(parseSplitEodId(splitEodId("m1", "UPS"))).toEqual({ manifestId: "m1", carrierCode: "UPS" });
    expect(parseSplitEodId("m1")).toBeNull();
    expect(parsePendingEodId("6ccc3d35-7c1f")).toBeNull();
    expect(parsePendingEodId("pending~wh~conn~11/06/2026")).toBeNull();
  });
});

describe("EOD guards", () => {
  const open = { status: "Open", totalPackages: 3, isPrinted: false };
  const closed = { status: "Closed", totalPackages: 3, isPrinted: true };
  it("close needs open manifests with packages", () => {
    expect(closeBlockReason([open])).toBeNull();
    expect(closeBlockReason([open, closed])).toMatch(/Only Open/);
    expect(closeBlockReason([{ ...open, totalPackages: 0 }])).toMatch(/no active packages/);
  });
  it("reprint needs closed manifests", () => {
    expect(reprintBlockReason([closed])).toBeNull();
    expect(reprintBlockReason([closed, open])).toMatch(/closed manifests/);
  });
});

describe("shipment plan guards", () => {
  const plan = { warehouseId: "w1", clientId: "c1" };
  it("checks order eligibility by warehouse, client and status", () => {
    expect(orderEligibilityReason({ status: "Ready to Ship", warehouseId: "w1", clientId: "c1" }, plan)).toBeNull();
    expect(orderEligibilityReason({ status: "Open", warehouseId: "w2", clientId: "c1" }, plan)).toMatch(/another warehouse/);
    expect(orderEligibilityReason({ status: "Open", warehouseId: "w1", clientId: "c2" }, plan)).toMatch(/another client/);
    expect(orderEligibilityReason({ status: "Shipped", warehouseId: "w1", clientId: "c2" }, { ...plan, clientId: null })).toBe("is Shipped");
  });
  it("only Open plans delete; Shipped/Cancelled plans don't edit or ship", () => {
    expect(planDeleteBlockReason("Open")).toBeNull();
    expect(planDeleteBlockReason("In Progress")).toMatch(/Only Open/);
    expect(planEditBlockReason("Loading Started")).toBeNull();
    expect(planEditBlockReason("Shipped")).toMatch(/can't be edited/);
    expect(planShipBlockReason("Open", 2)).toBeNull();
    expect(planShipBlockReason("Open", 0)).toMatch(/at least one order/);
    expect(planShipBlockReason("Shipped", 2)).toMatch(/already shipped/);
    expect(planShipBlockReason("Cancelled", 2)).toMatch(/Cancelled/);
  });
  it("blocks Ship until at least one unshipped order is Ready to Ship", () => {
    expect(planShipBlockReason("Open", 2, 0, 0)).toMatch(/Ready to Ship/);
    expect(planShipBlockReason("Open", 2, 1, 0)).toBeNull();
    // one shipped, the other still unpicked: nothing left that Ship could move
    expect(planShipBlockReason("Loading Started", 2, 1, 1)).toMatch(/Ready to Ship/);
    expect(planShipBlockReason("Loading Started", 2, 2, 1)).toBeNull();
  });
  it("converts expected load units", () => {
    expect(ozToLb(44)).toBe(2.75);
    expect(in3ToFt3(1728 * 1.5)).toBe(1.5);
  });
  it("offers only eligible statuses in the order picker filter", () => {
    const status = PLAN_ELIGIBLE_ORDER_FIELDS.find((f) => f.field === "status");
    const values = status?.options?.map((o) => o.value) ?? [];
    expect(values).toContain("Ready to Ship");
    expect(values).not.toContain("Shipped");
    expect(values).not.toContain("Cancelled");
  });
});

describe("withFacets", () => {
  const fields: readonly ShippingField[] = [{ field: "carrier", label: "Carrier", type: "text", facet: "carriers" }, { field: "zone", label: "Zone", type: "text" }];
  it("turns facet fields into enums once options load and leaves others alone", () => {
    const filled = withFacets(fields, { warehouses: [], clients: [], carriers: [{ value: "UPS", label: "UPS" }], carrierAccounts: [], services: [] });
    expect(filled[0]).toMatchObject({ type: "enum", options: [{ value: "UPS", label: "UPS" }] });
    expect(filled[1]).toEqual(fields[1]);
  });
  it("falls back to text search while facets are loading", () => {
    expect(withFacets(fields, null)[0]?.type).toBe("text");
  });
});
