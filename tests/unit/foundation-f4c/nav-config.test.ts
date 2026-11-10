import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DASHBOARD_ITEM, HEADER_ITEMS, NAV_MENUS, USER_MENU_ITEMS, type NavItem } from "@/config/nav-config";
import { PAGE_TAB_GROUPS, PAGE_TAB_GROUP_KEYS, tabGroupForPath } from "@/config/page-tabs";
import { ROUTE_PATTERNS, ROUTE_REGISTRY } from "@/config/route-registry";
import { NAV_MENUS as SEARCH_TREE } from "@/components/layout/nav-config";
import { collectPages } from "@/server/search/pages";
import { PERMISSION_KEYS } from "@/server/auth/permission-catalog";

const ROOT = process.cwd();
const allItems = (): readonly NavItem[] => [
  DASHBOARD_ITEM,
  ...NAV_MENUS.flatMap((m) => [...m.columns.flatMap((c) => c.items), ...(m.footer ? [m.footer] : [])]),
  ...USER_MENU_ITEMS,
  ...HEADER_ITEMS,
];

function pageFileExists(pattern: string): boolean {
  const segments = pattern.split("/").filter(Boolean);
  return [path.join(ROOT, "src", "app"), path.join(ROOT, "src", "app", "(app)")].some((root) => fs.existsSync(path.join(root, ...segments, "page.tsx")));
}

describe("nav-config (F4.7)", () => {
  it("has the 7 Logiwa mega-menus in order", () => {
    expect(NAV_MENUS.map((m) => m.label)).toEqual(["Fulfillment", "Inventory", "Automation", "Integrations", "Reports", "Analytics", "Settings"]);
  });

  it("mirrors the Logiwa column structure and item counts", () => {
    const shape = Object.fromEntries(NAV_MENUS.map((m) => [m.label, m.columns.map((c) => `${c.heading}:${c.items.length}`)]));
    expect(shape).toEqual({
      Fulfillment: ["Outbound:5", "Task Management:4", "Shipment:2"],
      Inventory: ["Inbound:5", "Inventory:3", "Count Operations:3"],
      Automation: ["Workflows & Algorithms:4"],
      Integrations: ["Plugin Integrations:2", "Channel Logs:4", "Channel Monitoring:6", "Carrier Monitoring:1"],
      Reports: ["Orders:3", "Inventory:7", "Logs:8", "Receiving:2", "Warehouse Efficiency:1"],
      Analytics: ["Labor Analytics:5", "Operational Analytics:4"],
      Settings: ["Master Data:6", "Configuration:9", "Client Setup:4", "Users:3"],
    });
  });

  it("uses only real permission keys", () => {
    const keys = new Set(PERMISSION_KEYS);
    const unknown = allItems().flatMap((i) => i.permission).filter((k) => !keys.has(k));
    const tabUnknown = PAGE_TAB_GROUP_KEYS.flatMap((g) => PAGE_TAB_GROUPS[g].flatMap((t) => t.permission)).filter((k) => !keys.has(k));
    const routeUnknown = [...ROUTE_REGISTRY.values()].flatMap((r) => r.permission).filter((k) => !keys.has(k));
    expect([...unknown, ...tabUnknown, ...routeUnknown]).toEqual([]);
  });

  it("only links to static, absolute routes with an owner", () => {
    for (const navItem of allItems()) {
      expect(navItem.href).toMatch(/^\/[a-z0-9/-]*$/);
      expect(navItem.owner).toMatch(/^(M\d{2}|Foundation)$/);
    }
  });

  it("marks Retailers as BETA", () => {
    const retailers = allItems().find((i) => i.href === "/organization/retailers");
    expect(retailers?.badge).toBe("BETA");
  });

  it("feeds the search walker every page with its permission", () => {
    const pages = collectPages(SEARCH_TREE);
    const hrefs = new Set(pages.map((p) => p.href));
    for (const navItem of allItems()) expect(hrefs.has(navItem.href)).toBe(true);
    expect(pages.find((p) => p.href === "/orders")?.permission).toEqual(["fulfillment.shipment_orders.view"]);
    expect(pages.find((p) => p.href === "/orders")?.trail).toEqual(["Fulfillment", "Outbound"]);
  });
});

describe("page-tabs (F4.6)", () => {
  it("defines all 21 groups", () => {
    expect(PAGE_TAB_GROUP_KEYS).toHaveLength(21);
    // "work-orders" is a single-tab group by design (work-orders-kitting REQ-5); GroupTabs hides it.
    for (const key of PAGE_TAB_GROUP_KEYS) expect(PAGE_TAB_GROUPS[key].length).toBeGreaterThanOrEqual(key === "work-orders" ? 1 : 2);
  });

  it("finds the group of a tab route", () => {
    expect(tabGroupForPath("/orders/returns")).toBe("orders");
    expect(tabGroupForPath("/integrations/carrier-errors/void-label")).toBe("carrier-errors");
    expect(tabGroupForPath("/nowhere")).toBeNull();
  });
});

describe("route coverage", () => {
  it("every nav, tab and detail route resolves to a page file", () => {
    const tabRoutes = PAGE_TAB_GROUP_KEYS.flatMap((g) => PAGE_TAB_GROUPS[g].map((t) => t.href));
    const missing = [...new Set([...ROUTE_PATTERNS, ...tabRoutes])].filter((route) => !pageFileExists(route));
    expect(missing).toEqual([]);
  });

  it("every tab route is registered (so breadcrumbs resolve)", () => {
    const tabRoutes = PAGE_TAB_GROUP_KEYS.flatMap((g) => PAGE_TAB_GROUPS[g].map((t) => t.href));
    expect(tabRoutes.filter((r) => !ROUTE_REGISTRY.has(r))).toEqual([]);
  });
});
