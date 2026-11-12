/**
 * M11 parity round 4 (critic round 1, 6.4): pricing modes, duplicate-period protection, warehouse-time
 * "today", inclusive period ends, zero lines for every fee, Charge If value lookups, slim client
 * payloads, shipping-address contacts, detail-response defaults and explicit address change-log rows.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import {
  contractSchema, feeSchema, FEE_DEFAULTS, lastDayOf, periodsOverlap, priceFormula, priceQuantity, splitOneTime, todayIn, validatePricing, withOneTime,
} from "@/lib/grid-defs/organization/billing";
import { orgAddressModalSchema, orgAddressSchema, shipmentContactIssues } from "@/lib/grid-defs/organization/common";
import { clientSchema, CLIENT_DEFAULTS, parseClientDetail } from "@/lib/grid-defs/organization/clients";
import { approveReports, calculateContracts, previewCalculation } from "@/server/repositories/billing-reports";
import { createContract, createFee, getContract } from "@/server/repositories/billing";
import { chargeIfValues } from "@/server/repositories/billing-lookups";
import { createClient, listClients, slimClientRow, updateClient, getClient } from "@/server/repositories/clients";
import { createWorld, type World } from "../foundation/domain/fixtures";

const tiers = [{ fromQty: 1, toQty: 100, rate: 1 }, { fromQty: 101, toQty: 500, rate: 0.8 }, { fromQty: 501, toQty: null, rate: 0.5 }];

describe("pricing modes", () => {
  it("prices per unit, from quantity, tier base and graduated", () => {
    expect(priceQuantity(150, [{ fromQty: 1, toQty: null, rate: 0.25 }], "perUnit").total).toBe(37.5);
    expect(priceQuantity(150, [{ fromQty: 101, toQty: null, rate: 2 }], "fromQuantity")).toMatchObject({ total: 100, parts: [{ quantity: 50, fromQty: 101 }] });
    expect(priceQuantity(80, [{ fromQty: 101, toQty: null, rate: 2 }], "fromQuantity").total).toBe(0);
    // Tier base: all 150 units at the 101–500 rate; graduated: 100 × 1 + 50 × 0.8.
    expect(priceQuantity(150, tiers, "tierBase")).toMatchObject({ total: 120, parts: [{ quantity: 150, rate: 0.8 }] });
    expect(priceQuantity(150, tiers, "graduated").total).toBe(140);
    expect(priceQuantity(600, tiers, "tierBase").total).toBe(300);
    expect(priceFormula(150, tiers, "tierBase")).toBe("150 lands in 101–500: 150 × 0.80 = 120.00");
    expect(priceFormula(150, [{ fromQty: 101, toQty: null, rate: 2 }], "fromQuantity")).toBe("150 − 100 free = 50 × 2.00 = 100.00");
  });

  it("validates tiers per mode and round-trips the mode through the reserved marker", () => {
    expect(validatePricing("perUnit", tiers)).toMatch(/single rate/);
    expect(validatePricing("fromQuantity", [{ fromQty: 0, toQty: null, rate: 1 }])).toMatch(/1 or more/);
    expect(validatePricing("tierBase", tiers)).toBeNull();
    const stored = withOneTime([], false, "tierBase");
    expect(splitOneTime(stored)).toEqual({ chargeOneTime: false, pricingMode: "tierBase", conditions: [] });
    expect(withOneTime(stored, false, "graduated")).toEqual([]);
  });

  it("rejects an empty lookup value list", () => {
    const base = { ...FEE_DEFAULTS, tiers: [{ fromQty: 1, toQty: null, rate: 1 }], name: "Ship", operationType: "Shipment" as const, feeBy: "Per SO", chargeBy: "SO" };
    expect(feeSchema.safeParse({ ...base, conditions: [{ field: "carrier", comparator: "in", value: [] }] }).success).toBe(false);
    expect(feeSchema.safeParse({ ...base, conditions: [{ field: "carrier", comparator: "in", value: ["UPS"] }] }).success).toBe(true);
  });
});

describe("periods", () => {
  it("computes today in the warehouse time zone and inclusive period ends", () => {
    // 01:30 UTC on Nov 10 is still Nov 9 in Chicago.
    expect(todayIn("America/Chicago", new Date("2026-11-10T01:30:00.000Z"))).toBe("2026-11-09");
    expect(todayIn("Not/AZone", new Date("2026-11-10T01:30:00.000Z"))).toBe("2026-11-10");
    expect(lastDayOf("2026-11-01")).toBe("2026-10-31");
    expect(periodsOverlap("2026-10-01", "2026-10-31", "2026-10-31", "2026-11-30")).toBe(true);
    expect(periodsOverlap("2026-10-01", "2026-10-31", "2026-11-01", "2026-11-30")).toBe(false);
  });
});

describe("bill runs", () => {
  let w: World;
  let auth: AuthContext;
  const actor = () => ({ userId: w.userId, source: "Web" });
  beforeEach(async () => {
    w = await createWorld();
    const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
    auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  });
  afterEach(() => w.close());

  const contractWithFees = async () => {
    const contract = await createContract(w.db, auth, actor(), contractSchema.parse({ name: "Dup guard", clientId: w.clientId, warehouseId: w.warehouseId, calcStartDate: "2026-10-01", frequency: "Monthly" }));
    await createFee(w.db, auth, actor(), contract.id, feeSchema.parse({ ...FEE_DEFAULTS, name: "Account", operationType: "Recurring", feeBy: "Recurring", chargeBy: "Recurring", tiers: [{ fromQty: 1, toQty: null, rate: 50 }] }));
    await createFee(w.db, auth, actor(), contract.id, feeSchema.parse({ ...FEE_DEFAULTS, tiers: [{ fromQty: 1, toQty: null, rate: 1 }], name: "Split", operationType: "Storage", calculationType: "Split Month Storage", feeBy: "LP", chargeBy: "LP", splitDay: 15, standardRate: 10, alternateRate: 5 }));
    return contract;
  };

  it("never double-bills a period: drafts need explicit replacement, approved bills block", async () => {
    const contract = await contractWithFees();
    const now = new Date("2026-11-06T12:00:00.000Z");
    const first = await calculateContracts(w.db, auth, actor(), { ids: [contract.id], mode: "lastClosed" }, now);
    expect(first.reports[0]).toMatchObject({ status: "Successful", periodStart: "2026-10-01", periodEnd: "2026-10-31" });

    const preview = (await previewCalculation(w.db, auth, { ids: [contract.id], mode: "lastClosed" }, now)).previews[0]!;
    expect(preview).toMatchObject({ periodStart: "2026-10-01", periodEnd: "2026-10-31", blocked: null });
    expect(preview.conflicts.map((c) => c.billStatus)).toEqual(["Draft"]);

    const again = await calculateContracts(w.db, auth, actor(), { ids: [contract.id], mode: "lastClosed" }, now);
    expect(again.reports).toHaveLength(0);
    expect(again.failed[0]).toMatchObject({ code: "DUPLICATE" });

    const replaced = await calculateContracts(w.db, auth, actor(), { ids: [contract.id], mode: "lastClosed", replaceDrafts: true }, now);
    // Round 6: recalculated in place, same bill id and number (one bill per period).
    expect(replaced.reports[0]).toMatchObject({ reportId: first.reports[0]!.reportId, billNumber: first.reports[0]!.billNumber, replaced: [] });
    expect(await w.db.select().from(schema.billingReports)).toHaveLength(1);

    await approveReports(w.db, auth, actor(), [replaced.reports[0]!.reportId]);
    const blocked = await calculateContracts(w.db, auth, actor(), { ids: [contract.id], mode: "lastClosed", replaceDrafts: true }, now);
    expect(blocked.failed[0]?.message).toMatch(/Approved bill .* already covers/);
  });

  it("ends a to-date preview on today in the warehouse time zone", async () => {
    const contract = await contractWithFees();
    await w.db.update(schema.warehouses).set({ timezone: "America/Chicago" }).where(eq(schema.warehouses.id, w.warehouseId));
    const out = await calculateContracts(w.db, auth, actor(), { ids: [contract.id], mode: "current" }, new Date("2026-11-10T01:30:00.000Z"));
    expect(out.reports[0]).toMatchObject({ periodStart: "2026-11-01", periodEnd: "2026-11-09" });
    const stored = (await w.db.select().from(schema.billingReports).where(eq(schema.billingReports.id, out.reports[0]!.reportId)).limit(1))[0];
    expect(stored?.periodEnd).toBe("2026-11-09T23:59:59.999Z");
  });

  it("lists every fee on the consolidated bill, including a zero split-month storage line", async () => {
    const contract = await contractWithFees();
    const out = await calculateContracts(w.db, auth, actor(), { ids: [contract.id], mode: "lastClosed" }, new Date("2026-11-06T12:00:00.000Z"));
    const lines = (await w.db.select().from(schema.billingReportLines).where(eq(schema.billingReportLines.reportId, out.reports[0]!.reportId))).filter((l) => !l.isDetail);
    expect(new Set(lines.map((l) => l.feeName))).toEqual(new Set(["Account", "Split"]));
    expect(lines.find((l) => l.feeName === "Split")).toMatchObject({ totalPrice: 0, note: "No activity in this period" });
  });

  it("prices a tier-base fee and keeps its mode on the fee view", async () => {
    const contract = await createContract(w.db, auth, actor(), contractSchema.parse({ name: "Volume", clientId: w.clientId, warehouseId: w.warehouseId, calcStartDate: "2026-10-01", frequency: "Monthly" }));
    await createFee(w.db, auth, actor(), contract.id, feeSchema.parse({ ...FEE_DEFAULTS, name: "Acct", operationType: "Recurring", feeBy: "Recurring", chargeBy: "Recurring", pricingMode: "tierBase", tiers: [{ fromQty: 1, toQty: 1, rate: 75 }, { fromQty: 2, toQty: null, rate: 60 }] }));
    expect((await getContract(w.db, auth, contract.id)).fees[0]).toMatchObject({ pricingMode: "tierBase", conditions: [] });
    const out = await calculateContracts(w.db, auth, actor(), { ids: [contract.id], mode: "lastClosed" }, new Date("2026-11-06T12:00:00.000Z"));
    expect(out.reports[0]?.totalPrice).toBe(75);
  });

  it("offers real Charge If values for lookup attributes", async () => {
    const contract = await contractWithFees();
    const channels = (await chargeIfValues(w.db, auth, contract.id, "soChannel")).map((v) => v.value);
    expect(channels).toContain("Shopify");
    expect((await chargeIfValues(w.db, auth, contract.id, "priority")).map((v) => v.value)).toEqual(["None", "Low", "Medium", "High", "Urgent"]);
    expect(await chargeIfValues(w.db, auth, contract.id, "sku")).toEqual([]);
  });
});

describe("clients and addresses", () => {
  let w: World;
  let auth: AuthContext;
  const actor = () => ({ userId: w.userId, source: "Web" });
  beforeEach(async () => {
    w = await createWorld();
    const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
    auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  });
  afterEach(() => w.close());

  const ship = { name: "Dock", usageType: "Shipping" as const, line1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "US", isDefault: true, isActive: true };

  it("requires a contact on new shipping addresses but keeps saved ones editable", () => {
    expect(shipmentContactIssues({ usageType: "Shipping" }).map((i) => i.path[0])).toEqual(["firstName", "lastName", "email"]);
    expect(shipmentContactIssues({ usageType: "Billing" })).toEqual([]);
    expect(orgAddressSchema.safeParse(ship).success).toBe(false);
    expect(orgAddressSchema.safeParse({ ...ship, id: "saved-1" }).success).toBe(true);
    expect(orgAddressModalSchema.safeParse({ ...ship, id: "saved-1" }).success).toBe(false);
    expect(orgAddressSchema.safeParse({ ...ship, firstName: "Dana", lastName: "Ruiz", email: "d@example.com" }).success).toBe(true);
  });

  it("returns a slim picker row without tax ID or contact data, and logs address adds explicitly", async () => {
    const created = await createClient(w.db, auth, actor(), clientSchema.parse({ ...CLIENT_DEFAULTS, name: "Slim Co", code: "SLIM", officialName: "Slim Co LLC", taxId: "12-3456789", contactEmail: "a@slim.co",
      addresses: [{ ...ship, firstName: "Dana", lastName: "Ruiz", email: "d@slim.co" }] }));
    const row = (await listClients(w.db, auth, { page: 1, pageSize: 50, filters: [], sort: [], q: "Slim" } as never)).rows.find((r) => r.id === created.id)!;
    const slim = slimClientRow(row) as Record<string, unknown>;
    expect(Object.keys(slim).sort()).toEqual(["code", "currency", "fullName", "id", "name", "officialName", "status"]);
    expect(slim.taxId).toBeUndefined();

    const detail = await getClient(w.db, auth, created.id);
    await updateClient(w.db, auth, actor(), created.id, clientSchema.parse({ ...CLIENT_DEFAULTS, name: "Slim Co", code: "SLIM", officialName: "Slim Co LLC", version: detail.version,
      addresses: [...detail.addresses.map((a) => ({ ...a, line2: a.line2 ?? "", state: a.state ?? "", country: "US" })), { ...ship, name: "Returns", usageType: "Return" as const, isDefault: true }] }));
    const messages = (await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, created.id))).map((l) => l.message);
    expect(messages).toContain("Return address Returns added.");
    expect(messages.some((m) => /Address \d+ is modified/.test(m))).toBe(false);
  });

  it("parses a partial detail payload with safe defaults", () => {
    const d = parseClientDetail<{ sscc: { gs1CompanyPrefix: string }; addresses: { firstName: string | null }[]; kpis: { orders30d: number } }>({ id: "c1", name: "Old", addresses: [{ id: "a1", line1: "x" }] });
    expect(d?.sscc.gs1CompanyPrefix).toBe("");
    expect(d?.addresses[0]?.firstName).toBeNull();
    expect(d?.kpis.orders30d).toBe(0);
    expect(parseClientDetail({ nope: true })).toBeNull();
  });
});
