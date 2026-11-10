/**
 * M14 round 4 (parity loop): one-pass user validation (schema + password policy), deep data
 * restriction redaction, Screen Configuration receiving plan (conditions honoured), SO-type /
 * merge "Coming soon" gating, and the four Users bulk-import handlers.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AuthContext } from "@/server/auth/context";
import { AppError } from "@/server/api/errors";
import * as schema from "@/server/db/schema";
import { userSaveSchemaWithPolicy, USERS_ROLES_HELPER, USERS_ROLES_TITLE } from "@/lib/grid-defs/admin/users";
import { isMergeCriterionComingSoon, isSoTypeFlagEnforced, SO_TYPE_FLAGS } from "@/lib/grid-defs/admin/lookups";
import { receivingPlan, type ScreenStep } from "@/lib/grid-defs/admin/screen-configs";
import { deepRedactFor, restrictedExportColumns } from "@/server/repositories/roles-redaction";
import { parseUserSave, getUser, findUserByEmail } from "@/server/repositories/users";
import { applyLink, importUserLinkRow, importUserRow, importUserType, linkAction, splitFullName } from "@/server/repositories/users-import";
import { handler as usersHandler } from "@/server/imports/handlers/users";
import { handler as userRolesHandler } from "@/server/imports/handlers/user-roles";
import { handler as userWarehousesHandler } from "@/server/imports/handlers/user-warehouses";
import { handler as userClientsHandler } from "@/server/imports/handlers/user-clients";
import { createWorld, type World } from "../foundation/domain/fixtures";

const authFor = (w: World): AuthContext => {
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  return {
    scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], roleKeys: ["admin"],
    user: { id: w.userId, name: "Admin", email: "admin@test.io", role: "admin" }, context: { warehouseId: null, clientId: null },
  } as unknown as AuthContext;
};
const actorOf = (w: World) => ({ userId: w.userId, source: "Web" });

describe("POST /api/users validation reports every field at once", () => {
  const weakPolicy = (pw: string) => (pw.length < 12 ? ["Use at least 12 characters."] : []);
  it("returns roles, warehouses AND password policy errors in one pass", () => {
    const r = userSaveSchemaWithPolicy("create", weakPolicy).safeParse({
      firstName: "Sam", lastName: "Op", email: "sam@x.io", userType: "Operation", password: "short", confirmPassword: "short",
      roleIds: [], warehouseIds: [], allClients: true, clientIds: [],
    });
    expect(r.success).toBe(false);
    const paths = new Set(r.error!.issues.map((i) => i.path.join(".")));
    expect(paths).toEqual(new Set(["roleIds", "warehouseIds", "password"]));
  });
  it("skips the policy for an edit that leaves the password blank", () => {
    const r = userSaveSchemaWithPolicy("update", weakPolicy).safeParse({
      firstName: "Sam", lastName: "Op", email: "sam@x.io", userType: "Operation", password: "", confirmPassword: "",
      roleIds: ["r"], warehouseIds: ["w"], allClients: true, clientIds: [],
    });
    expect(r.success).toBe(true);
  });
  it("parseUserSave uses the company policy and throws one VALIDATION with all fieldErrors", () => {
    const w = createWorld();
    try {
      let err: unknown;
      try { parseUserSave(w.db, "create", { firstName: "", lastName: "Op", email: "sam@x.io", userType: "Operation", password: "a", confirmPassword: "a", roleIds: [], warehouseIds: [], allClients: true }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(AppError);
      const fe = (err as AppError).fieldErrors ?? {};
      expect(Object.keys(fe)).toEqual(expect.arrayContaining(["firstName", "roleIds", "warehouseIds", "password"]));
    } finally { w.close(); }
  });
  it("both tabs share one header", () => {
    expect(USERS_ROLES_TITLE).toBe("Users & Roles");
    expect(USERS_ROLES_HELPER.length).toBeGreaterThan(20);
  });
});

describe("deep data-restriction redaction", () => {
  const order = { id: "o1", code: "SO1", totalShippingCost: 12.5, shippingAccountNumber: "ACC-9", lines: [{ sku: "A", rate: 3 }], shipments: [{ packages: [{ labelCost: 4, trackingNumber: "1Z" }] }], createdAt: new Date(0) };
  it("nulls carrier cost at every depth, leaves other data, never mutates", () => {
    const out = deepRedactFor({ restrictions: ["carrier_cost"] }, order);
    expect(out.totalShippingCost).toBeNull();
    expect(out.lines[0]!.rate).toBeNull();
    expect(out.shipments[0]!.packages[0]!.labelCost).toBeNull();
    expect(out.shipments[0]!.packages[0]!.trackingNumber).toBe("1Z");
    expect(out.shippingAccountNumber).toBe("ACC-9");
    expect(out.createdAt).toBeInstanceOf(Date);
    expect(order.totalShippingCost).toBe(12.5);
  });
  it("carrier account data hides account numbers; no restriction returns the same reference", () => {
    expect(deepRedactFor({ restrictions: ["carrier_account_data"] }, order).shippingAccountNumber).toBeNull();
    expect(deepRedactFor({ restrictions: [] }, order)).toBe(order);
    expect(deepRedactFor(null, order)).toBe(order);
  });
  it("drops restricted export columns", () => {
    const cols = [{ key: "code" }, { key: "totalShippingCost" }, { key: "carrier" }];
    expect(restrictedExportColumns({ restrictions: ["carrier_cost"] }, cols).map((c) => c.key)).toEqual(["code", "carrier"]);
  });
});

describe("Screen Configuration receiving plan", () => {
  const lotTracked = { lot: true, expiry: false, production: false, serial: false };
  const steps = (over: Record<string, Partial<ScreenStep>>): ScreenStep[] =>
    ["scanLp", "lot", "expiry", "productionDate", "photo", "dimensions", "printLabel"].map((key) => ({ key, enabled: false, required: false, ...over[key] }));
  it("no matching config: tracked attributes are required, untracked hidden", () => {
    const p = receivingPlan(null, lotTracked);
    expect(p.tracking).toEqual({ lot: true, expiry: false, production: false, serial: false });
    expect(p.steps.find((s) => s.key === "expiry")).toEqual({ key: "expiry", show: false, required: false });
  });
  it("the matched config makes lot optional and photo / dimensions required", () => {
    const p = receivingPlan({ id: "c", name: "Drop Ship", steps: steps({ lot: { enabled: true, required: false }, photo: { enabled: true, required: true }, dimensions: { enabled: true, required: true } }) }, lotTracked);
    expect(p.configName).toBe("Drop Ship");
    expect(p.tracking.lot).toBe(false);
    expect(p.steps.find((s) => s.key === "lot")).toEqual({ key: "lot", show: true, required: false });
    expect(p.steps.find((s) => s.key === "photo")).toEqual({ key: "photo", show: true, required: true });
    expect(p.steps.find((s) => s.key === "dimensions")?.required).toBe(true);
  });
  it("a tracking step never applies to a product that doesn't track it", () => {
    const p = receivingPlan({ id: "c", name: "X", steps: steps({ expiry: { enabled: true, required: true } }) }, lotTracked);
    expect(p.tracking.expiry).toBe(false);
  });
});

describe("no silent no-op settings", () => {
  it("SO-type behaviours: only the ones a consumer reads are live", () => {
    expect(SO_TYPE_FLAGS.length).toBe(17);
    expect(SO_TYPE_FLAGS.filter(isSoTypeFlagEnforced)).toEqual(["createBackOrder", "allowPartialAllocation", "allowShipWithoutLabel"]);
  });
  it("every merge condition is live (order tag included)", () => {
    expect(isMergeCriterionComingSoon("orderTag")).toBe(false);
    expect(isMergeCriterionComingSoon("client")).toBe(false);
  });
});

describe("users bulk import helpers", () => {
  it("maps template user types, actions, names and links", () => {
    expect(importUserType("Web & Mobile")).toBe("Operation");
    expect(importUserType("client")).toBe("Client");
    expect(() => importUserType("Robot")).toThrow(/not valid/);
    expect(linkAction("unassign")).toBe("Unassign");
    expect(() => linkAction("maybe")).toThrow();
    expect(splitFullName("Sam Q. Operator")).toEqual({ firstName: "Sam", lastName: "Q. Operator" });
    expect(applyLink(["a"], "a", "Assign")).toEqual(["a"]);
    expect(applyLink(["a", "b"], "a", "Unassign")).toEqual(["b"]);
  });
  it("all four handlers are configured (no 'not configured yet' stubs)", () => {
    for (const h of [usersHandler, userRolesHandler, userWarehousesHandler, userClientsHandler]) {
      expect(h.configured).toBe(true);
      expect(h.owner).toBe("M14");
    }
  });
});

describe("users bulk import against the DB", () => {
  let w: World;
  let operatorId: string;
  let viewerId: string;
  beforeEach(() => {
    w = createWorld();
    operatorId = w.db.insert(schema.roles).values({ key: "operator", name: "Operator", category: "Operation" }).returning().get().id;
    viewerId = w.db.insert(schema.roles).values({ key: "viewer", name: "Viewer", category: "Operation" }).returning().get().id;
  });
  afterEach(() => w.close());

  it("creates a user with role + warehouse and an expired password, then updates by email", () => {
    const res = importUserRow(w.db, authFor(w), actorOf(w), { email: "New.Op@X.io", name: "New Operator", userType: "Web", roleName: "operator", defaultWarehouseCode: "mlt1", allClients: true, status: "Active" });
    const d = getUser(w.db, res.entityId);
    expect(d.email).toBe("new.op@x.io");
    expect(d.roleIds).toEqual([operatorId]);
    expect(d.warehouseIds).toEqual([w.warehouseId]);
    expect(findUserByEmail(w.db, "new.op@x.io")?.passwordChangedAt).toBeNull();
    const logs = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, res.entityId)).all();
    expect(logs.length).toBeGreaterThan(0);

    importUserRow(w.db, authFor(w), actorOf(w), { email: "new.op@x.io", name: "Renamed Operator", userType: "Client", roleName: "Viewer", status: "Inactive" });
    const after = getUser(w.db, res.entityId);
    expect(after.name).toBe("Renamed Operator");
    expect(after.userType).toBe("Client");
    expect(after.isActive).toBe(false);
    expect(new Set(after.roleIds)).toEqual(new Set([operatorId, viewerId]));
  });

  it("rejects unknown roles / warehouses and a new user without a role", () => {
    expect(() => importUserRow(w.db, authFor(w), actorOf(w), { email: "a@x.io", name: "A B", roleName: "Nope", defaultWarehouseCode: "MLT1" })).toThrow(/Role "Nope"/);
    expect(() => importUserRow(w.db, authFor(w), actorOf(w), { email: "a@x.io", name: "A B", roleName: "Operator", defaultWarehouseCode: "ZZZ" })).toThrow(/Warehouse "ZZZ"/);
    expect(() => importUserRow(w.db, authFor(w), actorOf(w), { email: "a@x.io", name: "A B", defaultWarehouseCode: "MLT1" })).toThrow(/Role is required/);
  });

  it("assigns / unassigns roles, keeps at least one, and is idempotent", () => {
    const { entityId } = importUserRow(w.db, authFor(w), actorOf(w), { email: "r@x.io", name: "R User", roleName: "Operator", defaultWarehouseCode: "MLT1" });
    importUserLinkRow(w.db, authFor(w), actorOf(w), "role", { email: "r@x.io", roleName: "Viewer", action: "Assign" });
    expect(new Set(getUser(w.db, entityId).roleIds)).toEqual(new Set([operatorId, viewerId]));
    expect(importUserLinkRow(w.db, authFor(w), actorOf(w), "role", { email: "r@x.io", roleName: "Viewer", action: "Assign" }).message).toMatch(/already assigned/);
    importUserLinkRow(w.db, authFor(w), actorOf(w), "role", { email: "r@x.io", roleName: "Operator", action: "Unassign" });
    expect(getUser(w.db, entityId).roleIds).toEqual([viewerId]);
    expect(() => importUserLinkRow(w.db, authFor(w), actorOf(w), "role", { email: "r@x.io", roleName: "Viewer", action: "Unassign" })).toThrow(/at least one role/);
    expect(() => importUserLinkRow(w.db, authFor(w), actorOf(w), "role", { email: "ghost@x.io", roleName: "Viewer", action: "Assign" })).toThrow(/No user/);
  });

  it("user-client import switches to Select manually; all-clients users can't lose one client", () => {
    importUserRow(w.db, authFor(w), actorOf(w), { email: "c@x.io", name: "C User", roleName: "Operator", defaultWarehouseCode: "MLT1" });
    expect(() => importUserLinkRow(w.db, authFor(w), actorOf(w), "client", { email: "c@x.io", clientCode: "ACME", action: "Unassign" })).toThrow(/all clients/);
    const id = findUserByEmail(w.db, "c@x.io")!.id;
    w.db.update(schema.users).set({ allClients: false }).where(eq(schema.users.id, id)).run();
    w.db.insert(schema.userClients).values({ userId: id, clientId: w.otherClientId }).run();
    importUserLinkRow(w.db, authFor(w), actorOf(w), "client", { email: "c@x.io", clientCode: "acme", action: "Assign" });
    expect(new Set(getUser(w.db, id).clientIds)).toEqual(new Set([w.clientId, w.otherClientId]));
    expect(() => importUserLinkRow(w.db, authFor(w), actorOf(w), "warehouse", { email: "c@x.io", warehouseCode: "MLT1", action: "Unassign" })).toThrow(/at least one warehouse/);
  });
});
