/**
 * M14 round 3 (parity loop): permission View rule, global search for users / roles / zero-
 * insensitive codes, notification center (severity, plurals, filters, delete), help content,
 * feedback schema, retailer packing templates, and Location Zone › Match With Product Groups.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AuthContext } from "@/server/auth/context";
import * as schema from "@/server/db/schema";
import { PERMISSIONS } from "@/server/auth/permission-catalog";
import { requiredViewOf, roleSchema, toggleWithViewRule, withImpliedViews } from "@/lib/grid-defs/admin/roles";
import { createRole, updateRole, getRole } from "@/server/repositories/roles";
import { parseCodeQuery } from "@/server/search/match";
import { provider as usersProvider } from "@/server/search/providers/users";
import { provider as rolesProvider } from "@/server/search/providers/roles";
import { effectiveSeverity, fixPlurals, kindGroup, kindGroupLabel, matchesSeverity, notificationDeleteSchema, sinceIso } from "@/lib/grid-defs/admin/notifications";
import { deleteNotifications, listNotifications, notificationListQuerySchema } from "@/server/repositories/platform-activity";
import { articlesForPath, HELP_CATEGORIES, searchHelp, WHATS_NEW } from "@/components/layout/help-content";
import { feedbackPage, feedbackSchema } from "@/lib/grid-defs/admin/account";
import { layoutSchema, normalizeLayout, RETAILER_SPECS, templatesFor } from "@/lib/grid-defs/admin/printouts";
import { lookupBySlug, MERGE_CRITERIA, sameIdSet, zoneGroupIds, zoneGroupsSchema } from "@/lib/grid-defs/admin/lookups";
import { setZoneProductGroups, zoneProductGroups } from "@/server/repositories/company-zone-groups";
import { createWorld, type World } from "../foundation/domain/fixtures";

const authFor = (w: World): AuthContext => {
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  return { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId, name: "Admin", email: "admin@test.io" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
};
const actorOf = (w: World) => ({ userId: w.userId, source: "Web" });

describe("permission matrix: actions imply View", () => {
  const view = "fulfillment.shipment_orders.view";
  const actions = PERMISSIONS.filter((p) => p.groupKey === "fulfillment" && p.pageKey === "shipment_orders" && p.action !== "view").map((p) => p.key);
  it("finds the page's View for an action, none for View itself", () => {
    expect(requiredViewOf(actions[0]!)).toBe(view);
    expect(requiredViewOf(view)).toBeNull();
    expect(requiredViewOf("nope.nope.nope")).toBeNull();
  });
  it("adds View for every granted action (idempotent)", () => {
    const out = withImpliedViews(actions);
    expect(out).toContain(view);
    expect(withImpliedViews(out)).toEqual(out);
    expect(out.filter((k) => k === view)).toHaveLength(1);
  });
  it("ticking an action ticks View; unticking View clears the page", () => {
    const on = toggleWithViewRule([], [actions[0]!]);
    expect(on.keys).toEqual(expect.arrayContaining([actions[0], view]));
    expect(on.clearedPages).toEqual([]);
    const off = toggleWithViewRule(on.keys, [view]);
    expect(off.keys).toEqual([]);
    expect(off.clearedPages).toEqual(["Shipment Orders"]);
    // Unticking a single action keeps View.
    expect(toggleWithViewRule(on.keys, [actions[0]!]).keys).toEqual([view]);
  });
  it("the whole-page toggle still clears everything without a warning", () => {
    const page = [view, ...actions];
    const all = toggleWithViewRule([], page);
    expect(new Set(all.keys)).toEqual(new Set(page));
    expect(toggleWithViewRule(all.keys, page)).toEqual({ keys: [], clearedPages: [] });
  });

  let w: World;
  beforeEach(() => { w = createWorld(); });
  afterEach(() => w.close());
  it("the server normalizes a role saved with actions but no View", () => {
    const input = roleSchema.parse({ name: "KS-TEST no view", description: "x", category: "Operation", permissions: actions.slice(0, 3) });
    const { id } = createRole(w.db, authFor(w), actorOf(w), input);
    expect(getRole(w.db, id).permissions).toContain(view);
    const before = getRole(w.db, id);
    updateRole(w.db, authFor(w), actorOf(w), id, { ...input, permissions: [actions[4]!], version: before.version });
    expect(new Set(getRole(w.db, id).permissions)).toEqual(new Set([actions[4], view]));
  });
});

describe("global search: users, roles and zero-insensitive codes", () => {
  it("parses document codes with any zero padding", () => {
    expect(parseCodeQuery("PO0002")).toEqual({ prefix: "PO", digits: "2" });
    expect(parseCodeQuery("so-010916")).toEqual({ prefix: "SO", digits: "10916" });
    expect(parseCodeQuery("APX-TEE-BLK-M")).toBeNull();
    expect(parseCodeQuery("admin@kitstak")).toBeNull();
  });

  let w: World;
  beforeEach(() => { w = createWorld(); });
  afterEach(() => w.close());
  it("finds users by email and roles by name, with deep links", async () => {
    w.db.insert(schema.users).values({ email: "jordan.reyes@kitstak.io", name: "Jordan Reyes", passwordHash: "x", role: "operator" }).run();
    const roleId = w.db.insert(schema.roles).values({ key: "po002210_role", name: "PO002210 Receivers", description: "Receivers", category: "Operation" }).returning().get().id;
    const ctx = (q: string) => ({ db: w.db, auth: authFor(w), q, limit: 5 });
    const users = await usersProvider.search(ctx("jordan.reyes@kit"));
    expect(users.map((u) => u.title)).toEqual(["Jordan Reyes"]);
    expect(users[0]?.href).toMatch(/^\/settings\/users\?id=/);
    expect(JSON.stringify(users)).not.toContain("passwordHash");
    const roles = await rolesProvider.search(ctx("PO22"));
    expect(roles.map((r) => r.id)).toEqual([roleId]);
    expect(roles[0]?.href).toBe(`/settings/roles?id=${roleId}`);
    expect(await rolesProvider.count?.(ctx("PO0002"))).toBe(1);
  });
});

describe("notification center", () => {
  it("fixes producer plurals", () => {
    expect(fixPlurals("1 jobs created, 1 units short")).toBe("1 job created, 1 unit short");
    expect(fixPlurals("Wave 112-1 completed: 19 shortage")).toBe("Wave 112-1 completed: 19 shortages");
    expect(fixPlurals("3 SKUs skipped")).toBe("3 SKUs skipped");
    expect(fixPlurals("1 SKUs skipped")).toBe("1 SKU skipped");
  });
  it("raises success to warning when the copy reports shortages or skips", () => {
    expect(effectiveSeverity("success", "Wave 112-1 completed", "4 jobs, 19 shortages")).toBe("warning");
    expect(effectiveSeverity("success", "Replenishment", "3 SKUs skipped (No reserve stock)")).toBe("warning");
    expect(effectiveSeverity("success", "Wave 7 completed", "4 jobs, 0 shortages")).toBe("success");
    expect(effectiveSeverity("error", "x", null)).toBe("error");
    expect(matchesSeverity("attention", "warning")).toBe(true);
    expect(matchesSeverity("attention", "success")).toBe(false);
  });
  it("groups kinds and computes date bounds", () => {
    expect(kindGroup("wave.completed")).toBe("wave");
    expect(kindGroupLabel("wave")).toBe("Waves");
    expect(kindGroupLabel("zebra")).toBe("Zebra");
    const now = new Date("2026-11-10T15:00:00Z");
    expect(sinceIso("all", now)).toBeNull();
    expect(sinceIso("7d", now)).toBe("2026-11-03T15:00:00.000Z");
    expect(notificationDeleteSchema.safeParse({}).success).toBe(false);
    expect(notificationDeleteSchema.safeParse({ read: true }).success).toBe(true);
  });

  let w: World;
  beforeEach(() => { w = createWorld(); });
  afterEach(() => w.close());
  it("filters by type, severity and unread, and deletes only the caller's rows", () => {
    const other = w.db.insert(schema.users).values({ email: "o@test.io", name: "O", passwordHash: "x", role: "operator" }).returning().get().id;
    const ins = (userId: string, kind: string, title: string, body: string, read = false) =>
      w.db.insert(schema.notifications).values({ userId, kind, title, body, severity: "success", readAt: read ? new Date().toISOString() : null }).returning().get().id;
    const a = ins(w.userId, "wave.completed", "Wave 1 completed", "2 jobs, 19 shortage");
    ins(w.userId, "wave.completed", "Wave 2 completed", "1 jobs, 0 shortages", true);
    ins(w.userId, "return.received", "RMA 7 received", "1 units");
    const theirs = ins(other, "wave.completed", "Theirs", "x", true);
    const q = (over: Record<string, string>) => notificationListQuerySchema.parse({ ...over });
    const all = listNotifications(w.db, w.userId, q({}));
    expect(all.total).toBe(3);
    expect(all.types).toEqual(["return", "wave"]);
    expect(all.rows.find((r) => r.id === a)?.severity).toBe("warning");
    expect(all.rows.find((r) => r.id === a)?.body).toBe("2 jobs, 19 shortages");
    expect(listNotifications(w.db, w.userId, q({ type: "wave" })).total).toBe(2);
    expect(listNotifications(w.db, w.userId, q({ severity: "attention" })).rows.map((r) => r.id)).toEqual([a]);
    expect(listNotifications(w.db, w.userId, q({ unread: "true" })).total).toBe(2);
    expect(deleteNotifications(w.db, w.userId, { read: true }).deleted).toBe(1);
    expect(deleteNotifications(w.db, w.userId, { ids: [theirs] }).deleted).toBe(0);
    expect(w.db.select().from(schema.notifications).where(eq(schema.notifications.id, theirs)).get()).toBeTruthy();
  });
});

describe("help panel content and feedback", () => {
  it("ships the 8 Logiwa collections with content", () => {
    expect(HELP_CATEGORIES.map((c) => c.title)).toEqual(["Process Manuals", "Reports", "Integrations", "Workflow Rules", "Client Management", "Setup", "Release Notes", "Account Management"]);
    const ids = HELP_CATEGORIES.flatMap((c) => c.articles.map((a) => a.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("privacy");
    expect(ids).toContain("direct-print");
    for (const c of HELP_CATEGORIES) for (const a of c.articles) for (const l of a.links ?? []) expect(l.href).toMatch(/^\//);
    expect(WHATS_NEW.length).toBeGreaterThan(0);
  });
  it("picks articles for the current page, longest prefix first", () => {
    expect(articlesForPath("/receiving/abc").map((a) => a.id)).toContain("receive-po");
    expect(articlesForPath("/settings/printouts/packing-list")[0]?.id).toMatch(/printouts|direct-print/);
    expect(articlesForPath("/nowhere")).toEqual([]);
  });
  it("searches titles and steps", () => {
    expect(searchHelp("wave").map((a) => a.id)).toContain("waves");
    expect(searchHelp("   ")).toEqual([]);
  });
  it("validates feedback and strips query strings from the page", () => {
    expect(feedbackSchema.safeParse({ type: "idea", message: "short" }).success).toBe(false);
    expect(feedbackSchema.parse({ type: "problem", message: "The label did not print", page: "/orders/x" }).rating).toBeNull();
    expect(feedbackSchema.safeParse({ type: "idea", message: "Long enough message", page: "https://evil.example" }).success).toBe(false);
    expect(feedbackPage("/orders?q=secret#x")).toBe("/orders");
  });
});

describe("retailer-compliant packing lists", () => {
  it("offers Target, Macy's, QVC, Staples Dropship, Walmart and Amazon on packing types only", () => {
    const keys = templatesFor("packing-list").map((t) => t.name);
    for (const r of ["Target", "Macy's", "QVC", "Staples Dropship", "Walmart", "Amazon"]) expect(keys).toContain(`${r} packing list`);
    expect(templatesFor("packing-list").length).toBeGreaterThanOrEqual(9);
    expect(templatesFor("picking-list").some((t) => t.key.startsWith("retailer-"))).toBe(false);
    expect(RETAILER_SPECS).toHaveLength(6);
  });
  it("every retailer layout is valid, hides prices and survives normalize", () => {
    for (const t of templatesFor("packing-slip").filter((x) => x.key.startsWith("retailer-"))) {
      const layout = t.layout("packing-slip");
      expect(layoutSchema.safeParse(layout).success, t.key).toBe(true);
      expect(layout.columns.filter((c) => c.enabled).map((c) => c.key)).not.toContain("price");
      expect(layout.sections.find((s) => s.key === "totals")?.enabled).toBe(false);
      expect(normalizeLayout("packing-slip", layout).blocks).toHaveLength(layout.blocks.length);
    }
  });
});

describe("Data Setup: order merge rule and Match With Product Groups", () => {
  it("merge rules are warehouse-scoped and offer Order tag", () => {
    const def = lookupBySlug("order-merge-rule")!;
    expect(def.scope).toBe("warehouse");
    expect(def.scopeRequired).toBe(true);
    expect(MERGE_CRITERIA.some((c) => c.key === "orderTag")).toBe(true);
  });
  it("zone group helpers", () => {
    expect(zoneGroupIds({ productGroupIds: ["a", "a", 3, "", "b"] })).toEqual(["a", "b"]);
    expect(zoneGroupIds(null)).toEqual([]);
    expect(sameIdSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameIdSet(["a"], ["a", "b"])).toBe(false);
    expect(zoneGroupsSchema.safeParse({ assignments: [] }).success).toBe(false);
  });

  let w: World;
  beforeEach(() => { w = createWorld(); });
  afterEach(() => w.close());
  it("saves product groups per zone with a change log and rejects unknown groups", () => {
    const zone = w.db.insert(schema.lookupValues).values({ type: "location_zone", name: "Zone A", code: "ZA", warehouseId: w.warehouseId, meta: { priority: 1 } }).returning().get().id;
    const g1 = w.db.insert(schema.lookupValues).values({ type: "product_group", name: "Apparel" }).returning().get().id;
    const g2 = w.db.insert(schema.lookupValues).values({ type: "product_group", name: "Shoes" }).returning().get().id;
    const auth = authFor(w);
    expect(setZoneProductGroups(w.db, auth, actorOf(w), { assignments: [{ zoneId: zone, productGroupIds: [g1, g2] }] }).updated).toBe(1);
    const row = zoneProductGroups(w.db, auth).zones.find((z) => z.id === zone)!;
    expect(new Set(row.productGroupIds)).toEqual(new Set([g1, g2]));
    const meta = w.db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, zone)).get()!.meta as Record<string, unknown>;
    expect(meta.priority).toBe(1);
    // No-op save changes nothing.
    expect(setZoneProductGroups(w.db, auth, actorOf(w), { assignments: [{ zoneId: zone, productGroupIds: [g2, g1] }] }).updated).toBe(0);
    expect(() => setZoneProductGroups(w.db, auth, actorOf(w), { assignments: [{ zoneId: zone, productGroupIds: ["00000000-0000-4000-8000-000000000000"] }] })).toThrow(/no longer exists/);
    const logs = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, zone)).all();
    expect(logs.length).toBe(1);
  });
});
