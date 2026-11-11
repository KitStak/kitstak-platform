/** M11 round 2: Charge If catalogue per operation, Kit / Component charge by, Charge One Time, 16-digit bill numbers, SO-fact conditions. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import {
  CHARGE_IF_FIELDS, chargeByOptions, chargeIfFieldsFor, contractSchema, feeSchema, FEE_DEFAULTS, ONE_TIME_FIELD, splitOneTime, withOneTime,
} from "@/lib/grid-defs/organization/billing";
import { createContract, createFee, getContract } from "@/server/repositories/billing";
import { calculateContracts } from "@/server/repositories/billing-reports";
import { wideBillNumber } from "@/server/repositories/billing-engine";
import { createWorld, type World } from "../foundation/domain/fixtures";
import { forEachSeq } from "@/server/db/sql";

describe("Charge If catalogue", () => {
  it("offers SO, carrier, SO detail and 50 custom-field slots, scoped per operation", () => {
    expect(CHARGE_IF_FIELDS.length).toBeGreaterThanOrEqual(100);
    expect(CHARGE_IF_FIELDS.filter((f) => f.key.startsWith("cf.")).length).toBe(50);
    const ship = chargeIfFieldsFor("Shipment").map((f) => f.key);
    expect(ship).toEqual(expect.arrayContaining(["carrier", "carrierRate", "labelCost", "nofLines", "shipmentMethod", "shipmentOrderType", "shipmentPackageType", "soStore", "orderTag", "priority", "discount", "totalShippingCost", "soTotalWeight", "carrierBillingType", "lineNote1", "lineNote3", "cf.so.textBox1", "cf.shipmentPlan.toggle2"]));
    expect(ship).not.toContain("locationZone");
    expect(chargeIfFieldsFor("Storage").map((f) => f.key)).not.toContain("carrier");
    expect(chargeIfFieldsFor("Recurring")).toEqual([]);
    expect(new Set(CHARGE_IF_FIELDS.map((f) => f.key)).size).toBe(CHARGE_IF_FIELDS.length);
  });

  it("rejects a condition that does not apply to the fee's operation", () => {
    const base = { ...FEE_DEFAULTS, tiers: [{ fromQty: 1, toQty: null, rate: 1 }], name: "Ship", operationType: "Shipment" as const, feeBy: "Per SO", chargeBy: "SO" };
    expect(feeSchema.safeParse({ ...base, conditions: [{ field: "shipmentOrderType", comparator: "equals", value: "D2C" }] }).success).toBe(true);
    const bad = feeSchema.safeParse({ ...base, conditions: [{ field: "locationZone", comparator: "equals", value: "A" }] });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/doesn't apply to Shipment fees/);
  });

  it("adds Kit and Component charge by for Shipment per product", () => {
    expect(chargeByOptions("Shipment", "Per Product")).toEqual(["Product (UOM Quantity)", "Product (Pack Quantity)", "SKU", "Kit (UOM Quantity)", "Component (UOM Quantity)"]);
  });

  it("Charge One Time is Recurring-only and round-trips through the reserved marker", () => {
    const rec = { ...FEE_DEFAULTS, tiers: [{ fromQty: 1, toQty: null, rate: 1 }], name: "Setup", operationType: "Recurring" as const, feeBy: "Recurring", chargeBy: "Recurring" };
    expect(feeSchema.parse({ ...rec, chargeOneTime: true }).chargeOneTime).toBe(true);
    expect(feeSchema.safeParse({ ...FEE_DEFAULTS, tiers: [{ fromQty: 1, toQty: null, rate: 1 }], name: "R", operationType: "Receiving", feeBy: "Per PO", chargeBy: "PO", chargeOneTime: true }).success).toBe(false);
    const stored = withOneTime([{ field: "sku", comparator: "equals" as const, value: "A" }], true);
    expect(stored.map((c) => c.field)).toEqual(["sku", ONE_TIME_FIELD]);
    expect(splitOneTime(stored)).toEqual({ chargeOneTime: true, pricingMode: "graduated", conditions: [{ field: "sku", comparator: "equals", value: "A" }] });
    expect(withOneTime(stored, false).map((c) => c.field)).toEqual(["sku"]);
  });
});

describe("engine round 2", () => {
  let w: World;
  let auth: AuthContext;
  const actor = () => ({ userId: w.userId, source: "Web" });
  beforeEach(async () => {
    w = await createWorld();
    const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
    auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  });
  afterEach(() => w.close());

  it("numbers bills with 16 digits and a sequence that is not capped at 999", async () => {
    const at = new Date("2026-11-06T12:00:00.000Z");
    const a = await wideBillNumber(w.db, at);
    const b2 = await wideBillNumber(w.db, at);
    expect(a).toMatch(/^261106\d{10}$/);
    expect(Number(b2.slice(6))).toBe(Number(a.slice(6)) + 1);
  });

  it("charges a one-time recurring fee only on the first successful bill", async () => {
    const contract = await createContract(w.db, auth, actor(), contractSchema.parse({ name: "Setup co", clientId: w.clientId, warehouseId: w.warehouseId, calcStartDate: "2026-09-01", frequency: "Monthly" }));
    await createFee(w.db, auth, actor(), contract.id, feeSchema.parse({ ...FEE_DEFAULTS, name: "Onboarding", operationType: "Recurring", feeBy: "Recurring", chargeBy: "Recurring", chargeOneTime: true, tiers: [{ fromQty: 1, toQty: null, rate: 500 }] }));
    await createFee(w.db, auth, actor(), contract.id, feeSchema.parse({ ...FEE_DEFAULTS, name: "Account", operationType: "Recurring", feeBy: "Recurring", chargeBy: "Recurring", tiers: [{ fromQty: 1, toQty: null, rate: 50 }] }));
    expect((await getContract(w.db, auth, contract.id)).fees.find((f) => f.name === "Onboarding")?.chargeOneTime).toBe(true);
    expect((await getContract(w.db, auth, contract.id)).fees.find((f) => f.name === "Onboarding")?.conditions).toEqual([]);
    const row = (await w.db.select().from(schema.billingFees).where(eq(schema.billingFees.name, "Onboarding")).limit(1))[0]!;
    expect(Boolean(row.chargeOneTime)).toBe(true); // R2-1: a real column, no reserved marker
    expect(row.conditions.some((c) => c.field === ONE_TIME_FIELD)).toBe(false);
    const first = (await calculateContracts(w.db, auth, actor(), { ids: [contract.id], mode: "custom", start: "2026-09-01", end: "2026-09-30" }, new Date("2026-10-02T12:00:00.000Z"))).reports[0]!;
    expect(first.totalPrice).toBe(550);
    const second = (await calculateContracts(w.db, auth, actor(), { ids: [contract.id], mode: "custom", start: "2026-10-01", end: "2026-10-31" }, new Date("2026-11-02T12:00:00.000Z"))).reports[0]!;
    expect(second.totalPrice).toBe(50);
    const rows = await w.db.select().from(schema.billingReports).where(eq(schema.billingReports.contractId, contract.id));
    expect(rows).toHaveLength(2);
  });
});

describe("engine SQL with SO / carrier / custom facts", () => {
  it("runs every shipment and pick & pack collector with conditions without SQL errors", async () => {
    const w = await createWorld();
    try {
      const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
      const auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
      const actor = { userId: w.userId, source: "Web" };
      const contract = await createContract(w.db, auth, actor, contractSchema.parse({ name: "SQL", clientId: w.clientId, warehouseId: w.warehouseId, calcStartDate: "2026-10-01", frequency: "Monthly" }));
      const cond = [{ field: "carrier", comparator: "equals" as const, value: "UPS" }, { field: "cf.so.toggle1", comparator: "equals" as const, value: true }];
      const fees: [string, string, string][] = [["Shipment", "Per SO", "SO"], ["Shipment", "Per Label", "Label"], ["Shipment", "Shipment Package", "Shipment Package"], ["Shipment", "Per Product", "Kit (UOM Quantity)"], ["Shipment", "Per Product", "Component (UOM Quantity)"], ["Pick & Pack", "Per Picking", "SO"]];
      await forEachSeq(fees, async ([op, feeBy, chargeBy], i) => await createFee(w.db, auth, actor, contract.id, feeSchema.parse({ ...FEE_DEFAULTS, name: `F${i}`, operationType: op, feeBy, chargeBy, conditions: [...cond, ...(op === "Shipment" && feeBy === "Per Product" ? [{ field: "lineNote1", comparator: "isNotEmpty" as const, value: null }] : [])], tiers: [{ fromQty: 1, toQty: null, rate: 1 }] })));
      await createFee(w.db, auth, actor, contract.id, feeSchema.parse({ ...FEE_DEFAULTS, name: "Store", operationType: "Storage", calculationType: "At Period End", feeBy: "Location", chargeBy: "Location", conditions: [{ field: "cf.lpType.textBox1", comparator: "equals", value: "X" }, { field: "onlySingleSku", comparator: "equals", value: true }], tiers: [{ fromQty: 1, toQty: null, rate: 1 }] }));
      await createFee(w.db, auth, actor, contract.id, feeSchema.parse({ ...FEE_DEFAULTS, name: "Recv", operationType: "Receiving", feeBy: "Per LP", chargeBy: "LP", conditions: [{ field: "cf.location.textBox1", comparator: "equals", value: "X" }], tiers: [{ fromQty: 1, toQty: null, rate: 1 }] }));
      const out = (await calculateContracts(w.db, auth, actor, { ids: [contract.id], mode: "lastClosed" }, new Date("2026-11-06T12:00:00.000Z"))).reports[0]!;
      expect(out.errorMessage).toBeNull();
      expect(out.status).toBe("Successful");
    } finally {
      await w.close();
    }
  });
});

describe("client wizard Others step: SSCC-18", () => {
  it("persists the SSCC-18 settings and returns them on the detail", async () => {
    const { CLIENT_DEFAULTS, clientSchema } = await import("@/lib/grid-defs/organization/clients");
    const { createClient, getClient } = await import("@/server/repositories/clients");
    const w = await createWorld();
    try {
      const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
      const auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
      const bad = clientSchema.safeParse({ ...CLIENT_DEFAULTS, name: "SSCC Co", code: "SSCC1", officialName: "SSCC Co LLC", sscc: { extensionDigit: "1", gs1CompanyPrefix: "061414", serialNumber: "" } });
      expect(bad.success).toBe(false);
      const input = clientSchema.parse({ ...CLIENT_DEFAULTS, name: "SSCC Co", code: "SSCC1", officialName: "SSCC Co LLC", sscc: { extensionDigit: "1", gs1CompanyPrefix: "0614141", serialNumber: "1" } });
      const { id } = await createClient(w.db, auth, { userId: w.userId, source: "Web" }, input);
      expect((await getClient(w.db, auth, id)).sscc).toEqual({ extensionDigit: "1", gs1CompanyPrefix: "0614141", serialNumber: "1" });
    } finally {
      await w.close();
    }
  });
});
