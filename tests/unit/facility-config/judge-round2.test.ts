import { describe, expect, it } from "vitest";
import { zoneMatchesProductGroup } from "@/server/domain/putaway-actions";

describe("REQ-J1-1 zone ↔ product group match", () => {
  it("uses the zone's matched product groups when set", () => {
    const stats = { zoneName: "Bulk", zoneProductGroupIds: new Set(["g1", "g2"]) };
    expect(zoneMatchesProductGroup(stats, "g1", "Anything")).toBe(true);
    expect(zoneMatchesProductGroup(stats, "g3", "Bulk")).toBe(false);
    expect(zoneMatchesProductGroup(stats, null, null)).toBe(false);
  });
  it("falls back to the zone-name rule when no groups are matched", () => {
    expect(zoneMatchesProductGroup({ zoneName: "Frozen", zoneProductGroupIds: new Set() }, "g1", "frozen")).toBe(true);
    expect(zoneMatchesProductGroup({ zoneName: "Frozen" }, "g1", "Dry")).toBe(false);
    expect(zoneMatchesProductGroup({ zoneName: null }, "g1", "Dry")).toBe(false);
  });
});
