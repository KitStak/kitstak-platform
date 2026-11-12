import { afterEach, describe, expect, it } from "vitest";
import { clients, warehouses } from "@/server/db/schema";
import { assertInScope, getScope, narrowScope, scopedWhere, type Scope } from "@/server/auth/scope";
import { seededDb, type SeededDb } from "./fixtures";

describe("scope", () => {
  let t: SeededDb;
  afterEach(async () => await t.close());

  it("admin sees all warehouses; a linked user only theirs; allClients => all", async () => {
    t = await seededDb();
    const admin = await getScope(t.db, { id: t.ids.admin, role: "admin", allClients: true });
    expect([...admin.warehouseIds].sort()).toEqual([t.ids.wh1, t.ids.wh2]);
    expect(admin.clientIds).toBe("all");
    expect(await getScope(t.db, { id: t.ids.viewer, role: "viewer", allClients: false })).toEqual({ warehouseIds: [t.ids.wh1], clientIds: [t.ids.c1] });
    // Unlinked non-admin falls back to every warehouse (pre-seed compatibility).
    expect((await getScope(t.db, { id: t.ids.operator, role: "operator", allClients: true })).warehouseIds).toHaveLength(2);
  });

  it("scopedWhere filters by warehouse and client columns", async () => {
    t = await seededDb();
    const scope: Scope = { warehouseIds: [t.ids.wh2], clientIds: [t.ids.c1] };
    const whRows = await t.db.select({ id: warehouses.id }).from(warehouses).where(scopedWhere(warehouses, scope, { warehouseId: warehouses.id }));
    expect(whRows.map((r) => r.id)).toEqual([t.ids.wh2]);
    const cRows = await t.db.select({ id: clients.id }).from(clients).where(scopedWhere(clients, scope, { clientId: clients.id }));
    expect(cRows.map((r) => r.id)).toEqual([t.ids.c1]);
    expect(scopedWhere(clients, { warehouseIds: [], clientIds: "all" }, { clientId: clients.id })).toBeUndefined();
    const none = await t.db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(scopedWhere(warehouses, { warehouseIds: [], clientIds: "all" }, { warehouseId: warehouses.id }));
    expect(none).toEqual([]);
  });

  it("narrowScope never widens", () => {
    const scope: Scope = { warehouseIds: ["a", "b"], clientIds: ["c1"] };
    expect(narrowScope(scope, "a", "c1")).toEqual({ warehouseIds: ["a"], clientIds: ["c1"] });
    expect(narrowScope(scope, "zzz", "c9")).toEqual(scope);
    expect(narrowScope({ warehouseIds: ["a"], clientIds: "all" }, null, "c5")).toEqual({ warehouseIds: ["a"], clientIds: ["c5"] });
  });

  it("assertInScope throws NOT_FOUND (not FORBIDDEN) across scope", () => {
    const scope: Scope = { warehouseIds: ["a"], clientIds: ["c1"] };
    expect(() => assertInScope(scope, { warehouseId: "a", clientId: "c1" })).not.toThrow();
    expect(() => assertInScope(scope, { warehouseId: "a", clientId: null })).not.toThrow();
    for (const record of [null, { warehouseId: "b" }, { clientId: "c2" }]) {
      expect(() => assertInScope(scope, record, "Order")).toThrow(expect.objectContaining({ code: "NOT_FOUND", message: "Order not found" }));
    }
  });
});
