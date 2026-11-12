import { describe, expect, it } from "vitest";
import { NAV_MENUS } from "@/config/nav-config";
import { activeMenuKey } from "@/config/nav-access";
import { PAGE_TAB_GROUPS } from "@/config/page-tabs";

describe("Jobs hub top-nav highlight (R2-1)", () => {
  it.each(["/jobs", "/jobs/wave-rules", "/jobs/allocation-exceptions", "/jobs/wave-log", "/jobs/shortage", "/jobs/abc", "/tasks/order-operations", "/tasks/count", "/tasks/replenishment"])("%s highlights Fulfillment", (path) => {
    expect(activeMenuKey(NAV_MENUS, path)).toBe("fulfillment");
  });
  it("does not capture look-alike prefixes", () => {
    expect(activeMenuKey(NAV_MENUS, "/jobsx")).not.toBe("fulfillment");
  });
  it("exposes Job Types from the Jobs hub tabs", () => {
    expect(PAGE_TAB_GROUPS.jobs.some((t) => t.href === "/settings/job-types")).toBe(true);
  });
});
