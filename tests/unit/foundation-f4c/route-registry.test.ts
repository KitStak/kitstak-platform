import { describe, expect, it } from "vitest";
import { NAV_MENUS } from "@/config/nav-config";
import { activeMenuKey, isAllowed, isItemActive, visibleMenus, visibleTabs } from "@/config/nav-access";
import { PAGE_TAB_GROUPS } from "@/config/page-tabs";
import { breadcrumbsFor, matchesPattern, resolveNearestRoute, resolveRoute, routeLabelFromParam } from "@/config/route-registry";

describe("route-registry", () => {
  it("matches dynamic segments one-for-one", () => {
    expect(matchesPattern("/orders/[id]", "/orders/abc")).toBe(true);
    expect(matchesPattern("/orders/[id]", "/orders/abc/edit")).toBe(false);
    expect(matchesPattern("/orders/shipped", "/orders/shipped")).toBe(true);
  });

  it("prefers static routes over dynamic ones", () => {
    expect(resolveRoute("/orders/shipped")?.pattern).toBe("/orders/shipped");
    expect(resolveRoute("/orders/new")?.pattern).toBe("/orders/new");
    expect(resolveRoute("/orders/7f3a")?.pattern).toBe("/orders/[id]");
    expect(resolveRoute("/orders/returns/42")?.pattern).toBe("/orders/returns/[id]");
    expect(resolveRoute("/nope")).toBeNull();
  });

  it("falls back to the nearest ancestor", () => {
    expect(resolveNearestRoute("/orders/7f3a/edit")?.pattern).toBe("/orders/[id]");
    expect(resolveNearestRoute("/totally/unknown")).toBeNull();
  });

  it("derives Logiwa-style breadcrumbs (menu text, linked parents, plain current page)", () => {
    expect(breadcrumbsFor("/orders/shipped")).toEqual([{ label: "Fulfillment" }, { label: "Shipped & Canceled Orders" }]);
    expect(breadcrumbsFor("/orders/abc", "SO010421")).toEqual([{ label: "Fulfillment" }, { label: "Shipment Orders", href: "/orders" }, { label: "SO010421" }]);
    expect(breadcrumbsFor("/automation/algorithms/putaway/new")).toEqual([
      { label: "Automation" },
      { label: "Algorithms", href: "/automation/algorithms" },
      { label: "Putaway Algorithm", href: "/automation/algorithms/putaway" },
      { label: "New Putaway Algorithm" },
    ]);
    expect(breadcrumbsFor("/account/profile")).toEqual([{ label: "Account" }, { label: "My Profile" }]);
    expect(breadcrumbsFor("/dashboard")).toEqual([{ label: "Dashboard" }]);
    expect(breadcrumbsFor("/x/y", "Fallback")).toEqual([{ label: "Fallback" }]);
  });

  it("only echoes registered same-origin routes from query params", () => {
    expect(routeLabelFromParam("/settings/users")).toBe("Users");
    expect(routeLabelFromParam(["/clients/abc"])).toBe("Client Details");
    expect(routeLabelFromParam("//evil.example.com")).toBeNull();
    expect(routeLabelFromParam("https://evil.example.com")).toBeNull();
    expect(routeLabelFromParam(undefined)).toBeNull();
  });
});

describe("nav-access", () => {
  it("treats an empty requirement as public and otherwise any-of", () => {
    expect(isAllowed([], new Set())).toBe(true);
    expect(isAllowed(["a", "b"], new Set(["b"]))).toBe(true);
    expect(isAllowed(["a"], new Set(["b"]))).toBe(false);
  });

  it("drops forbidden items, empty columns and empty menus", () => {
    const granted = new Set(["fulfillment.shipment_orders.view", "settings.users.view"]);
    const menus = visibleMenus(NAV_MENUS, granted);
    expect(menus.map((m) => m.key)).toEqual(["fulfillment", "reports", "settings"]);
    expect(menus[0]?.columns.map((c) => c.items.map((i) => i.href))).toEqual([["/orders", "/orders/shipped"]]);
    expect(menus[2]?.columns.map((c) => c.heading)).toEqual(["Users"]);
    expect(menus[2]?.footer?.href).toBe("/settings");
    expect(visibleMenus(NAV_MENUS, new Set())).toEqual([]);
  });

  it("does not mutate the source config", () => {
    const before = JSON.stringify(NAV_MENUS);
    visibleMenus(NAV_MENUS, new Set(["settings.users.view"]));
    expect(JSON.stringify(NAV_MENUS)).toBe(before);
  });

  it("filters tabs by permission", () => {
    const tabs = visibleTabs(PAGE_TAB_GROUPS.orders, new Set(["fulfillment.shipment_orders.view"]));
    expect(tabs.map((t) => t.href)).toEqual(["/orders", "/orders/shipped"]);
  });

  it("finds the active item and owning menu", () => {
    expect(isItemActive({ href: "/orders" }, "/orders/abc")).toBe(true);
    expect(isItemActive({ href: "/orders" }, "/orders-x")).toBe(false);
    expect(activeMenuKey(NAV_MENUS, "/shipments/history")).toBe("fulfillment");
    expect(activeMenuKey(NAV_MENUS, "/products/123")).toBe("inventory");
    expect(activeMenuKey(NAV_MENUS, "/integrations/channels/shopify")).toBe("integrations");
    expect(activeMenuKey(NAV_MENUS, "/dashboard")).toBeNull();
  });
});
