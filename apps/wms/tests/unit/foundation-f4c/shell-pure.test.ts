import { describe, expect, it } from "vitest";
import { NAV_MENUS, USER_MENU_ITEMS } from "@/config/nav-config";
import { flattenPages, highlightParts, matchPages, parseRecentSearches, pushRecentSearch, RECENT_SEARCH_LIMIT } from "@/components/layout/search-utils";
import { passwordChecks, passwordMeetsPolicy } from "@/components/layout/password-checks";
import { isTaskActive, todaysTasks, type BackgroundTask } from "@/components/layout/transactions-tray";
import { contextSummary, optionLabel } from "@/components/layout/context-switcher";
import { errorDigest } from "@/components/layout/error-view";
import { roleLabel } from "@/components/layout/user-menu";
import { pageCount } from "@/components/layout/notifications-page";

describe("global search helpers", () => {
  const pages = flattenPages(NAV_MENUS, USER_MENU_ITEMS);

  it("flattens unique pages with menu › column trails", () => {
    expect(new Set(pages.map((p) => p.href)).size).toBe(pages.length);
    expect(pages.find((p) => p.href === "/orders")?.trail).toBe("Fulfillment › Outbound");
    expect(pages.find((p) => p.href === "/account/profile")?.trail).toBe("Account");
  });

  it("matches Logiwa's 'ship' example and ranks prefix matches first", () => {
    const labels = matchPages(pages, "ship", 20).map((p) => p.label);
    const prefix = labels.filter((l) => l.toLowerCase().startsWith("ship"));
    expect(labels.slice(0, prefix.length)).toEqual(prefix);
    expect(labels.indexOf("Shipment Orders")).toBeLessThan(labels.indexOf("Shipment History"));
    expect(matchPages(pages, "ship").map((p) => p.label)).toContain("Workflow Blocked Shipment Orders");
    expect(labels).toEqual(expect.arrayContaining(["Carrier Shipment Details", "Missing Shipment Orders", "Workflow Blocked Shipment Orders", "Orders and Shipments"]));
  });

  it("matches aliases and respects the limit", () => {
    expect(matchPages(pages, "atp").map((p) => p.href)).toContain("/inventory/atp");
    expect(matchPages(pages, "inv", 3)).toHaveLength(3);
    expect(matchPages(pages, "   ")).toEqual([]);
  });

  it("highlights every case-insensitive occurrence", () => {
    expect(highlightParts("Shipment Shipped", "SHIP")).toEqual([
      { text: "Ship", match: true },
      { text: "ment ", match: false },
      { text: "Ship", match: true },
      { text: "ped", match: false },
    ]);
    expect(highlightParts("Orders", "")).toEqual([{ text: "Orders", match: false }]);
  });

  it("keeps recent searches deduplicated, capped and validated", () => {
    const list = Array.from({ length: 10 }, (_, i) => `term${i}`).reduce<readonly string[]>((acc, t) => pushRecentSearch(acc, t), []);
    expect(list).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(list[0]).toBe("term9");
    expect(pushRecentSearch(["SO1", "abc"], "so1")).toEqual(["so1", "abc"]);
    expect(pushRecentSearch(["abc"], "x")).toEqual(["abc"]);
    expect(parseRecentSearches('["a1","b2"]')).toEqual(["a1", "b2"]);
    expect(parseRecentSearches("{bad json")).toEqual([]);
    expect(parseRecentSearches('[1,2]')).toEqual([]);
    expect(parseRecentSearches(null)).toEqual([]);
  });
});

describe("password checklist", () => {
  const policy = { minLength: 10, requireUpper: true, requireNumber: true, requireSymbol: true };
  it("reports each rule", () => {
    const checks = passwordChecks("abc", policy);
    expect(checks.map((c) => [c.key, c.ok])).toEqual([["length", false], ["upper", false], ["lower", true], ["number", false], ["symbol", false]]);
    expect(passwordMeetsPolicy("KitStak!demo2026", policy)).toBe(true);
    expect(passwordMeetsPolicy("longenough1!", { ...policy, requireUpper: false })).toBe(true);
  });
});

describe("transactions tray", () => {
  const task = (over: Partial<BackgroundTask>): BackgroundTask => ({ id: "t", kind: "export", title: "Orders", status: "completed", progress: 100, rowCount: 1, errorMessage: null, fileId: null, fileName: null, createdAt: "2026-11-05T10:00:00.000Z", finishedAt: null, ...over });
  it("keeps today's and still-running tasks", () => {
    const now = new Date(2026, 10, 5, 15, 0, 0);
    const today = task({ id: "a", createdAt: new Date(2026, 10, 5, 9).toISOString() });
    const old = task({ id: "b", createdAt: new Date(2026, 10, 3, 9).toISOString() });
    const running = task({ id: "c", status: "started", createdAt: new Date(2026, 10, 1).toISOString() });
    expect(todaysTasks([today, old, running], now).map((t) => t.id)).toEqual(["a", "c"]);
    expect(isTaskActive({ status: "queued" })).toBe(true);
    expect(isTaskActive({ status: "error" })).toBe(false);
  });
});

describe("header helpers", () => {
  const warehouses = [{ id: "w1", code: "MLT1", name: "Main" }];
  const clients = [{ id: "c1", code: null, name: "Apex Threads" }];
  it("summarises the working context", () => {
    // Short, never-truncated trigger text (fix2): codes, "All" for no client.
    expect(contextSummary({ warehouseId: "w1", clientId: null }, warehouses, clients)).toBe("MLT1 · All");
    expect(contextSummary({ warehouseId: null, clientId: "c1" }, warehouses, clients)).toBe("All WH · Apex Threads");
    expect(optionLabel(warehouses[0], "x")).toBe("MLT1 - Main");
    expect(optionLabel(undefined, "fallback")).toBe("fallback");
  });

  it("labels roles and reads error digests safely", () => {
    expect(roleLabel("manager")).toBe("Supervisor");
    expect(roleLabel("custom")).toBe("Custom");
    expect(errorDigest(Object.assign(new Error("x"), { digest: "abc" }))).toBe("abc");
    expect(errorDigest("boom")).toBeNull();
    expect(errorDigest(null)).toBeNull();
  });

  it("counts notification pages", () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
  });
});
