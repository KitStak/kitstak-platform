/**
 * Blind-judge repair round 1 (M14): SO type behaviours read by allocation, merge-rule policy,
 * printers scan-to-assign, SSO / branding helpers, custom field entities, app settings schema.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { allocateOrders } from "@/server/domain/allocation";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { soTypeFlagsOf } from "@/server/domain/so-type-flags";
import { cleanStatePatch, mergeGroupKey, mergeInheritance, orderMergeGroup } from "@/server/repositories/order-merge-policy";
import { brandAccentCss } from "@/server/repositories/apps-branding";
import { emailDomainAllowed, samlMetadataXml } from "@/server/repositories/apps-sso";
import { scanTarget } from "@/components/layout/printers-popover";
import { detailFromRow } from "@/components/admin/users/user-panels";
import { appSettingsSchema, fieldApplies, getAppDef, isSecureUrl } from "@/lib/grid-defs/admin/apps";
import { CUSTOM_FIELD_ENTITY_LIST, customFieldEntityOf, customFieldsHref } from "@/lib/grid-defs/admin/custom-fields";
import { CUSTOM_FIELD_ENTITIES } from "@/lib/enums";
import { MERGE_CRITERIA, MERGE_INHERITANCE, SO_TYPE_FLAGS_ENFORCED, ZONE_PUTAWAY_SETTINGS_ENFORCED } from "@/lib/grid-defs/admin/lookups";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

describe("Shipment Order Type behaviours in allocation", () => {
  let w: World;
  beforeEach(async () => { w = await createWorld(); });
  afterEach(() => w.close());
  const soType = async (flags: string[]) => (await w.db.insert(schema.lookupValues).values({ type: "so_type", name: `T-${flags.join("-") || "none"}`, meta: { flags: Object.fromEntries(flags.map((k) => [k, true])) } }).returning())[0].id;
  const stock = async (qty: number) => await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty });
  const order = async (qty: number, typeId: string | null) => await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }], typeId ? { orderTypeId: typeId } : {}));
  const row = async (id: string) => (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).limit(1))[0];
  const allocated = async (id: string) => (await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, id))).reduce((s, l) => s + l.allocatedQuantity, 0);
  const alloc = async (id: string) => await allocateOrders(w.db, w.ctx, { orderIds: [id], warehouseId: w.warehouseId });

  it("without a type (or with no flags) a short order allocates nothing", async () => {
    await stock(2);
    const o = await order(5, await soType([]));
    expect((await alloc(o.id)).shortage).toEqual([o.id]);
    expect(await allocated(o.id)).toBe(0);
    expect((await row(o.id))?.status).toBe("Shortage");
  });

  it("Allow partial allocation keeps what is available and stays in Shortage", async () => {
    await stock(2);
    const o = await order(5, await soType(["allowPartialAllocation"]));
    expect((await alloc(o.id)).shortage).toEqual([o.id]);
    expect(await allocated(o.id)).toBe(2);
    expect((await row(o.id))?.status).toBe("Shortage");
  });

  it("Create back order releases the available part and moves the rest to <code>-BO1", async () => {
    await stock(2);
    const o = await order(5, await soType(["createBackOrder"]));
    expect((await alloc(o.id)).allocated).toEqual([o.id]);
    expect((await row(o.id))?.status).toBe("Ready to Pick");
    const bo = (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.masterOrderId, o.id)).limit(1))[0];
    expect(bo?.code).toBe(`${o.code}-BO1`);
    expect(bo?.isBackOrder).toBe(true);
    expect(bo?.totalQuantity).toBe(3);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("reads flags defensively", () => {
    expect([...soTypeFlagsOf({ flags: ["a", 1, "b"] })]).toEqual(["a", "b"]);
    expect(soTypeFlagsOf(null).size).toBe(0);
    expect([...soTypeFlagsOf({ flags: { createBackOrder: true, allowLpSwap: false } })]).toEqual(["createBackOrder"]);
    expect([...SO_TYPE_FLAGS_ENFORCED].sort()).toEqual(["allowPartialAllocation", "allowShipWithoutLabel", "createBackOrder"]);
  });
});

describe("Order merge rule policy", () => {
  const o = (code: string, orderDate: string, extra: Record<string, unknown> = {}) => ({ code, orderDate, clientId: "c1", customerName: "Ann", shipZip: "38118", ...extra });
  it("data inheritance picks the master", () => {
    const g = [o("SO2", "2026-11-02"), o("SO1", "2026-11-01"), o("SO3", "2026-11-03")];
    expect(orderMergeGroup(g, "oldest")[0]?.code).toBe("SO1");
    expect(orderMergeGroup(g, "newest")[0]?.code).toBe("SO3");
    expect(orderMergeGroup(g, "clean")[0]?.code).toBe("SO1");
    expect(mergeInheritance({ inheritFrom: "newest" })).toBe("newest");
    expect(mergeInheritance({ inheritFrom: "bogus" })).toBe("oldest");
  });
  it("order tag condition groups by the tag set, order-insensitive", () => {
    const a = mergeGroupKey(o("A", "x"), ["client", "orderTag"], ["VIP", "Rush"]);
    const b = mergeGroupKey(o("B", "x"), ["client", "orderTag"], ["rush", "vip"]);
    const c = mergeGroupKey(o("C", "x"), ["client", "orderTag"], ["VIP"]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(mergeGroupKey(o("D", "x"), ["client", "orderTag"], [])).toBeNull();
    expect(mergeGroupKey(o("E", "x"), ["client"])).toBe("c1");
  });
  it("clean state clears free-text metadata only", () => {
    const { before, after } = cleanStatePatch({ note: "n", giftNote: "", extraNote1: "x", isGift: true, customerName: "Ann" });
    expect(before).toEqual({ note: "n", extraNote1: "x", isGift: true });
    expect(after).toEqual({ note: null, extraNote1: null, isGift: false });
  });
  it("merge options are no longer marked coming soon; zone put-away is live", () => {
    expect(MERGE_CRITERIA.some((c) => "comingSoon" in c)).toBe(false);
    expect(MERGE_INHERITANCE.some((m) => "comingSoon" in m)).toBe(false);
    expect(ZONE_PUTAWAY_SETTINGS_ENFORCED).toBe(true);
  });
});

describe("Printers scan-to-assign", () => {
  const empty = { barcodePrinter: "", laserPrinter: "" };
  it("routes by prefix, then model, then the first empty slot", () => {
    expect(scanTarget("LS: Office HP", empty)).toEqual({ slot: "laserPrinter", name: "Office HP" });
    expect(scanTarget("BC:Dock 1", empty)).toEqual({ slot: "barcodePrinter", name: "Dock 1" });
    expect(scanTarget("Zebra ZD421 Pack-3", empty)?.slot).toBe("barcodePrinter");
    expect(scanTarget("HP LaserJet M404", empty)?.slot).toBe("laserPrinter");
    expect(scanTarget("PRN-77", { barcodePrinter: "Z1", laserPrinter: "" })?.slot).toBe("laserPrinter");
    expect(scanTarget("   ", empty)).toBeNull();
  });
});

describe("User detail drawer seed", () => {
  it("builds a provisional detail from the grid row", () => {
    const d = detailFromRow({ id: "u1", name: "A B", firstName: "A", lastName: "B", email: "a@b.io", userType: "Operation", status: "Active", isActive: true, isApiUser: false, allClients: false, roleNames: "Admin, Viewer", warehouseCodes: "MLT1", lastLoginAt: null, passwordChangedAt: null, lockedUntil: null, activeSessions: 1, createdAt: "2026-01-01", version: 3 });
    expect(d.roles.map((r) => r.name)).toEqual(["Admin", "Viewer"]);
    expect(d.warehouses.map((x) => x.code)).toEqual(["MLT1"]);
    expect(d.version).toBe(3);
  });
});

describe("SSO and branding", () => {
  const sso = getAppDef("sso")!;
  it("OIDC fields are required only for OpenID Connect; a saved secret satisfies the requirement", () => {
    const base = { protocol: "OpenID Connect", provider: "Okta", issuer: "https://acme.okta.com", clientId: "abc", clientSecret: "", allowedDomains: "", enforce: false };
    expect(appSettingsSchema(sso).safeParse(base).success).toBe(false);
    expect(appSettingsSchema(sso, { savedSecrets: new Set(["clientSecret"]) }).safeParse(base).success).toBe(true);
    expect(appSettingsSchema(sso).safeParse({ ...base, issuer: "http://evil.example.com", clientSecret: "x" }).success).toBe(false);
    expect(appSettingsSchema(sso).safeParse({ protocol: "SAML 2.0", provider: "Okta", entityId: "e", ssoUrl: "https://idp/sso", certificate: "MII", enforce: false }).success).toBe(true);
    expect(fieldApplies(sso.settings.find((f) => f.key === "issuer")!, { protocol: "SAML 2.0" })).toBe(false);
    expect(isSecureUrl("http://localhost:9555")).toBe(true);
    expect(isSecureUrl("http://10.0.0.1")).toBe(false);
  });
  it("domain allow-list and SP metadata", () => {
    expect(emailDomainAllowed("a@acme.com", ["acme.com"])).toBe(true);
    expect(emailDomainAllowed("a@evil.com", ["acme.com"])).toBe(false);
    expect(emailDomainAllowed("a@any.com", [])).toBe(true);
    const xml = samlMetadataXml("https://wms.example.com");
    expect(xml).toContain('Location="https://wms.example.com/api/auth/sso/acs"');
    expect(xml).toContain("emailAddress");
  });
  it("brand accent CSS only for valid hex", () => {
    expect(brandAccentCss("#0F766E")).toContain("--primary:#0F766E");
    expect(brandAccentCss("red;}body{display:none")).toBe("");
  });
});

describe("Custom fields manager", () => {
  it("covers every custom-field entity with a link and permission", () => {
    expect(CUSTOM_FIELD_ENTITY_LIST.map((e) => e.key)).toEqual([...CUSTOM_FIELD_ENTITIES]);
    expect(customFieldEntityOf("lp_type")?.permission).toBe("settings.lp_types.custom_field_management");
    expect(customFieldsHref("shipment_package")).toBe("/settings/custom-fields?entity=shipment_package");
    expect(customFieldEntityOf("nope")).toBeUndefined();
  });
});
