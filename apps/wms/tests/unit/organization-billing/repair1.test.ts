/**
 * Blind-judge repair round 1: unit copy for legacy Charge By values, test identities hidden from the
 * client's Users with access, longest-match nav highlight, and the benchmark filter presets.
 */
import { describe, expect, it } from "vitest";
import { chargeUnit, BILLING_FIELDS, BILLING_FILTER_PRESET } from "@/lib/grid-defs/organization/billing";
import { BILLING_REPORT_FIELDS, BILLING_REPORT_FILTER_PRESET } from "@/lib/grid-defs/organization/billing-reports";
import { VAS_FIELDS, VAS_FILTER_PRESET } from "@/lib/grid-defs/organization/vas";
import { isTestIdentity } from "@/server/repositories/clients";
import { activeItemHref } from "@/config/nav-access";
import { withFilterPreset } from "@/components/organization/filter-preset";
import { permitted } from "@/components/organization/permitted";
import { NO_PERMISSION } from "@/components/facility/facility-shared";

describe("repair round 1", () => {
  it("never doubles the unit word", () => {
    expect(chargeUnit("Per Order")).toBe("order");
    expect(chargeUnit("Per Day")).toBe("day");
    expect(chargeUnit("Per Unit")).toBe("unit");
    expect(chargeUnit("SO")).toBe("SO");
    expect(chargeUnit("Product (UOM Quantity)")).toBe("Product");
    expect(chargeUnit("Recurring")).toBe("period");
  });

  it("recognises QA identities only", () => {
    expect(isTestIdentity("KS-CRIT Invite 95150", "x@kitstak.io")).toBe(true);
    expect(isTestIdentity("Someone", "ks-crit-r6m-91549@example.com")).toBe(true);
    expect(isTestIdentity("KS-E2E Client", "a@b.c")).toBe(true);
    expect(isTestIdentity("Dana Whitfield", "dana@apexthreads.com")).toBe(false);
    expect(isTestIdentity("Kssandra Lee", "kss@kitstak.io")).toBe(false);
  });

  it("highlights only the most specific menu item", () => {
    const menu = { columns: [{ items: [{ href: "/billing" }, { href: "/billing/reports" }, { href: "/billing/vas" }] }] } as unknown as Parameters<typeof activeItemHref>[0];
    expect(activeItemHref(menu, "/billing/reports/abc")).toBe("/billing/reports");
    expect(activeItemHref(menu, "/billing/123")).toBe("/billing");
    expect(activeItemHref(menu, "/clients")).toBeNull();
  });

  it("presets match benchmark filter fields that exist on the grid", () => {
    expect(VAS_FILTER_PRESET).toHaveLength(9);
    for (const [fields, preset] of [[VAS_FIELDS, VAS_FILTER_PRESET], [BILLING_REPORT_FIELDS, BILLING_REPORT_FILTER_PRESET], [BILLING_FIELDS, BILLING_FILTER_PRESET]] as const) {
      const names = new Set(fields.map((f) => f.field));
      for (const p of preset) expect(names.has(p)).toBe(true);
    }
    expect(BILLING_REPORT_FILTER_PRESET).toEqual(expect.arrayContaining(["billNumber", "createdAt"]));
    const marked = withFilterPreset([{ field: "billNumber", label: "B", type: "text" }, { field: "x", label: "X", type: "text" }], ["billNumber"]);
    expect(marked.map((f) => Boolean(f.preset))).toEqual([true, false]);
  });

  it("drops permission-only blocked actions", () => {
    const acts = [{ key: "a", disabledReason: NO_PERMISSION }, { key: "b", disabledReason: "3 orders reference this" }, { key: "c", disabledReason: null }];
    expect(permitted(acts).map((a) => a.key)).toEqual(["b", "c"]);
  });
});
