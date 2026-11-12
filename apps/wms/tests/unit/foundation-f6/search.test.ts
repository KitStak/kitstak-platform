import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPermissionKey } from "@/server/auth/permission-catalog";
import { collectPages, navPages, scorePage, searchPages } from "@/server/search/pages";
import { SEARCH_PROVIDERS, globalSearch, searchQuerySchema, visibleProviders } from "@/server/search/registry";
import { authFor, seededDb, type SeededDb } from "./fixtures";

const tree = [
  { label: "Fulfillment", sections: [{ heading: "Orders", links: [
    { label: "Shipment Orders", href: "/orders", aliases: ["SO"] },
    { label: "Shipped Orders", href: "/orders/shipped", permission: "fulfillment.shipment_orders.view" },
    { label: "Duplicate", href: "/orders" },
  ] }] },
  { label: "Settings", items: [{ label: "Users", href: "/settings/users", permission: ["settings.users.view"] }, { label: "External", href: "https://x" }] },
];

describe("pages provider", () => {
  it("flattens any nav shape, keeps trails and dedupes by href", () => {
    const pages = collectPages(tree);
    expect(pages.map((p) => p.href)).toEqual(["/orders", "/orders/shipped", "/settings/users"]);
    expect(pages[0]).toMatchObject({ trail: ["Fulfillment", "Orders"], aliases: ["SO"], permission: [] });
    expect(pages[2]?.permission).toEqual(["settings.users.view"]);
    expect(navPages().length).toBeGreaterThan(10);
  });

  it("scores and filters by permission", () => {
    const pages = collectPages(tree);
    expect(scorePage(pages[0]!, "ship")).toBe(3);
    expect(scorePage(pages[0]!, "ord")).toBe(2);
    expect(scorePage(pages[0]!, "so")).toBe(1);
    expect(scorePage(pages[0]!, "zzz")).toBe(0);
    const none = searchPages(pages, "or", 10, () => false).map((h) => h.href);
    expect(none).toEqual(["/orders"]);
    const all = searchPages(pages, "s", 10, () => true);
    expect(all.map((h) => h.title)).toEqual(["Shipment Orders", "Shipped Orders", "Users"]);
    expect(all[0]?.subtitle).toBe("Fulfillment › Orders");
  });
});

describe("global search", () => {
  let testDb: SeededDb;
  beforeEach(async () => { testDb = await seededDb(); });
  afterEach(async () => await testDb.close());

  it("registers record providers with valid permissions (all live since fix2)", () => {
    expect(SEARCH_PROVIDERS.map((p) => p.key)).toEqual(["pages", "orders", "pos", "products", "locations", "lps", "jobs", "clients", "users", "roles"]);
    for (const provider of SEARCH_PROVIDERS.slice(1)) {
      expect(provider.configured, provider.key).toBe(true);
      expect(provider.singular, provider.key).toBeTruthy();
      expect(provider.seeAllHref?.("x"), provider.key).toMatch(/^\/[a-z/-]+\?q=x$/);
      const perms = Array.isArray(provider.permission) ? provider.permission : [provider.permission];
      for (const key of perms) expect(isPermissionKey(key), String(key)).toBe(true);
    }
  });

  it("only runs configured providers the user may see and isolates failures", async () => {
    const auth = await authFor(testDb, testDb.ids.admin);
    expect(visibleProviders({ auth }).map((p) => p.key)).toEqual(["pages", "orders", "pos", "products", "locations", "lps", "jobs", "clients", "users", "roles"]);
    const groups = await globalSearch({ db: testDb.db, auth, q: "inventory", limit: 3 });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("pages");
    expect(groups[0]?.hits.length).toBeLessThanOrEqual(3);
    expect(await globalSearch({ db: testDb.db, auth, q: "inventory", limit: 3 }, ["orders"])).toEqual([]);

    const pages = SEARCH_PROVIDERS[0]!;
    vi.spyOn(pages, "search").mockImplementation(() => { throw new Error("broken"); });
    expect(await globalSearch({ db: testDb.db, auth, q: "inventory", limit: 3 })).toEqual([]);
  });

  it("validates the query", () => {
    expect(searchQuerySchema.safeParse({ q: " a " }).success).toBe(false);
    expect(searchQuerySchema.parse({ q: " ab ", limit: "7" })).toEqual({ q: "ab", limit: 7 });
    expect(searchQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
  });
});
