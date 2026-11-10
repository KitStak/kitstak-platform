import { afterEach, describe, expect, it } from "vitest";
import {
  countByGroup,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSIONS,
  getPermission,
  isPermissionKey,
  slugifyAction,
} from "@/server/auth/permission-catalog";
import { can, loadPermissions, redactFor, requirePermission } from "@/server/auth/permissions";
import { AppError } from "@/server/api/errors";
import { assignRole, seededDb, type SeededDb } from "./fixtures";

describe("permission catalog", () => {
  it("matches the 08 §Roles tree group totals (377 actions)", () => {
    const totals = Object.fromEntries(countByGroup(new Set()).map((g) => [g.groupKey, g.total]));
    expect(totals).toEqual({ fulfillment: 73, inventory: 67, automation: 22, integrations: 6, reports: 18, settings: 121, mobile: 68, analytics: 2 });
    expect(PERMISSION_KEYS).toHaveLength(377);
  });

  it("has unique, well-formed keys with labels", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const p of PERMISSIONS) {
      expect(p.key).toMatch(/^[a-z]+\.[a-z0-9_]+\.[a-z0-9_]+$/);
      expect(p.label.length).toBeGreaterThan(0);
    }
    expect(getPermission("fulfillment.shipment_orders.create")?.label).toBe("Create");
    expect(isPermissionKey("fulfillment.shipment_orders.picking_job_operations")).toBe(true);
    expect(isPermissionKey("nope.nope.nope")).toBe(false);
    expect(slugifyAction("Printouts & Labels")).toBe("printouts_and_labels");
  });

  it("manager = Supervisor set (Logiwa counts)", () => {
    const manager = new Set(DEFAULT_ROLE_PERMISSIONS.manager);
    const granted = Object.fromEntries(countByGroup(manager).map((g) => [g.groupKey, g.granted]));
    expect(granted).toEqual({ fulfillment: 70, inventory: 67, automation: 22, integrations: 6, reports: 18, settings: 116, mobile: 66, analytics: 2 });
  });

  it("admin has everything; viewer only views outside Settings/Mobile (+ self service)", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.admin).toEqual(PERMISSION_KEYS);
    const viewer = DEFAULT_ROLE_PERMISSIONS.viewer;
    expect(viewer).toContain("fulfillment.shipment_orders.view");
    expect(viewer).not.toContain("fulfillment.shipment_orders.create");
    expect(viewer).not.toContain("settings.users.view");
    expect(viewer).toContain("settings.my_profile.view");
    const settingsKeys = viewer.filter((k) => k.startsWith("settings."));
    expect(settingsKeys.sort()).toEqual(["settings.change_password.view", "settings.my_profile.view"]);
  });

  it("operator executes but has no settings, billing, users or deletes", () => {
    const op = new Set(DEFAULT_ROLE_PERMISSIONS.operator);
    expect(op.has("fulfillment.shipment_orders.ship_order")).toBe(true);
    expect(op.has("mobile.picking.pick_your_jobs")).toBe(true);
    expect(op.has("fulfillment.shipment_orders.delete")).toBe(false);
    expect(op.has("settings.billing.view")).toBe(false);
    expect(op.has("settings.users.view")).toBe(false);
    expect(op.has("automation.wave_rules.create")).toBe(false);
    expect(op.has("reports.shortage_report.view")).toBe(true);
  });
});

describe("permission resolution", () => {
  let t: SeededDb;
  afterEach(() => t.close());

  it("falls back to the legacy role's default set when no roles are assigned", () => {
    t = seededDb();
    const grant = loadPermissions(t.db, { id: t.ids.viewer, role: "viewer" });
    expect([...grant.permissions].sort()).toEqual([...DEFAULT_ROLE_PERMISSIONS.viewer].sort());
  });

  it("uses role_permissions (+ self service) and unions restrictions", () => {
    t = seededDb();
    assignRole(t, t.ids.operator, "clerk", ["inventory.atp.view", "bogus.key.x"], ["carrier_cost"]);
    assignRole(t, t.ids.operator, "client", ["reports.change_log.view"], ["carrier_cost", "rate_shopping_data"]);
    const grant = loadPermissions(t.db, { id: t.ids.operator, role: "operator" });
    expect(can(grant, "inventory.atp.view")).toBe(true);
    expect(can(grant, "reports.change_log.view")).toBe(true);
    expect(can(grant, "settings.my_profile.view")).toBe(true);
    expect(grant.permissions.has("bogus.key.x")).toBe(false);
    expect(can(grant, "fulfillment.shipment_orders.ship_order")).toBe(false);
    expect([...grant.restrictions].sort()).toEqual(["carrier_cost", "rate_shopping_data"]);
    expect([...grant.roleKeys].sort()).toEqual(["clerk", "client"]);
  });

  it("legacy admin is always a superuser", () => {
    t = seededDb();
    assignRole(t, t.ids.admin, "narrow", ["inventory.atp.view"]);
    expect(loadPermissions(t.db, { id: t.ids.admin, role: "admin" }).permissions.size).toBe(PERMISSION_KEYS.length);
  });

  it("requirePermission throws FORBIDDEN", () => {
    const subject = { permissions: new Set(["a.b.c"]) };
    expect(() => requirePermission(subject, "a.b.c")).not.toThrow();
    expect(() => requirePermission(subject, ["x.y.z", "a.b.c"])).not.toThrow();
    let thrown: unknown;
    try {
      requirePermission(subject, "x.y.z");
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("FORBIDDEN");
  });
});

describe("redactFor", () => {
  it("nulls restricted fields without mutating the input", () => {
    const row = Object.freeze({ id: "1", shippingCost: 12.5, accountNumber: "ACC", rateQuotes: [1] });
    const out = redactFor({ restrictions: ["carrier_cost", "rate_shopping_data"] }, row);
    expect(out).toEqual({ id: "1", shippingCost: null, accountNumber: "ACC", rateQuotes: null });
    expect(row.shippingCost).toBe(12.5);
    expect(redactFor({ restrictions: [] }, row)).toBe(row);
  });
});
