/** M11 pure rules: tiers, min/max, fee matrix validation, periods, address defaults, bill transitions. */
import { describe, expect, it } from "vitest";
import {
  chargeByOptions, feeByOptions, feeSchema, FEE_DEFAULTS, lastClosedPeriod, minMaxAdjust, periodContaining, periodEnd, tieredAmount, validateTiers,
} from "@/lib/grid-defs/organization/billing";
import { canTransitionBill } from "@/lib/grid-defs/organization/billing-reports";
import { normalizeDefaults, moneyGrid, moneyRail } from "@/lib/grid-defs/organization/common";
import { customerSchema } from "@/lib/grid-defs/organization/customers";
import { CLIENT_SETTING_COUNT, clientSsccSchema, enabledSwitchCount, fullSettings, previewSscc, readSscc, ssccCheckDigit, suggestClientCode } from "@/lib/grid-defs/organization/clients";
import { vasCalculationType, vasSchema } from "@/lib/grid-defs/organization/vas";
import { referenceTypeOf } from "@/server/imports/handlers/vas-operations";

describe("graduated tiers", () => {
  it("splits 150 units as 100 @ 3.00 + 50 @ 2.50 = 425.00", () => {
    const r = tieredAmount(150, [{ fromQty: 1, toQty: 100, rate: 3 }, { fromQty: 101, toQty: null, rate: 2.5 }]);
    expect(r.total).toBe(425);
    expect(r.parts).toEqual([
      { fromQty: 1, toQty: 100, quantity: 100, rate: 3, amount: 300 },
      { fromQty: 101, toQty: null, quantity: 50, rate: 2.5, amount: 125 },
    ]);
  });

  it("stays in the first tier below the break and charges a flat single tier", () => {
    expect(tieredAmount(80, [{ fromQty: 1, toQty: 100, rate: 3 }, { fromQty: 101, toQty: null, rate: 2.5 }]).total).toBe(240);
    expect(tieredAmount(2226, [{ fromQty: 1, toQty: null, rate: 0.25 }]).total).toBe(556.5);
    expect(tieredAmount(0, [{ fromQty: 1, toQty: null, rate: 3 }]).total).toBe(0);
  });

  it("validates contiguous tiers with only the last open-ended", () => {
    expect(validateTiers([{ fromQty: 1, toQty: 100, rate: 3 }, { fromQty: 101, toQty: null, rate: 2.5 }])).toBeNull();
    expect(validateTiers([{ fromQty: 1, toQty: 100, rate: 3 }, { fromQty: 50, toQty: null, rate: 2.5 }])).toBe("Charge 2: should start at 100 (where charge 1 ends)");
    expect(validateTiers([{ fromQty: 1, toQty: null, rate: 3 }, { fromQty: 101, toQty: null, rate: 2.5 }])).toBe("Charge 1: only the last charge can be open-ended");
    expect(validateTiers([])).toBe("Add at least one charge");
  });

  it("applies minimum and maximum adjustments to the period total", () => {
    expect(minMaxAdjust(180, { useMinPrice: true, minPrice: 250, useMaxPrice: false, maxPrice: null })).toBe(70);
    expect(minMaxAdjust(900, { useMinPrice: false, minPrice: null, useMaxPrice: true, maxPrice: 750 })).toBe(-150);
    expect(minMaxAdjust(400, { useMinPrice: true, minPrice: 250, useMaxPrice: true, maxPrice: 750 })).toBe(0);
  });
});

describe("operation → Fee By → Charge By matrix", () => {
  it("narrows options by operation and storage calculation type", () => {
    expect(feeByOptions("Pick & Pack")).toEqual(["Per Picking", "Per Packing"]);
    expect(feeByOptions("Storage", "Split Month Storage")).toEqual(["LP"]);
    expect(feeByOptions("Storage", "Distinct Period Count")).toEqual(["Location", "LP", "Parent LP"]);
    expect(chargeByOptions("Receiving", "Per Product")).toEqual(["Product (UOM Quantity)", "Product (Pack Quantity)"]);
    expect(chargeByOptions("VAS", "Operation")).toEqual(["Operation Value"]);
  });

  it("rejects a Charge By outside the matrix and requires the VAS type and storage calc type", () => {
    const bad = feeSchema.safeParse({ ...FEE_DEFAULTS, tiers: [{ fromQty: 1, toQty: null, rate: 1 }], name: "x", operationType: "Receiving", feeBy: "Per LP", chargeBy: "SO" });
    expect(bad.error?.issues.map((i) => i.path[0])).toContain("chargeBy");
    const vas = feeSchema.safeParse({ ...FEE_DEFAULTS, tiers: [{ fromQty: 1, toQty: null, rate: 1 }], name: "x", operationType: "VAS", feeBy: "Operation", chargeBy: "Operation Value", vasTypeId: null });
    expect(vas.error?.issues.map((i) => i.path[0])).toContain("vasTypeId");
    const storage = feeSchema.safeParse({ ...FEE_DEFAULTS, tiers: [{ fromQty: 1, toQty: null, rate: 1 }], name: "x", operationType: "Storage", calculationType: null, feeBy: "Location", chargeBy: "Location" });
    expect(storage.error?.issues.map((i) => i.path[0])).toContain("calculationType");
    const split = feeSchema.safeParse({ ...FEE_DEFAULTS, tiers: [{ fromQty: 1, toQty: null, rate: 1 }], name: "x", operationType: "Storage", calculationType: "Split Month Storage", feeBy: "LP", chargeBy: "LP", splitDay: 15, standardRate: null, alternateRate: 4 });
    expect(split.error?.issues.map((i) => i.path[0])).toEqual(["standardRate"]);
    const minMax = feeSchema.safeParse({ ...FEE_DEFAULTS, tiers: [{ fromQty: 1, toQty: null, rate: 1 }], name: "x", operationType: "Recurring", feeBy: "Recurring", chargeBy: "Recurring", useMinPrice: true, minPrice: 500, useMaxPrice: true, maxPrice: 100 });
    expect(minMax.error?.issues.map((i) => i.path[0])).toEqual(["maxPrice"]);
  });
});

describe("billing periods", () => {
  it("steps monthly, semi-monthly and weekly periods", () => {
    expect(periodEnd("2026-10-01", "Monthly")).toBe("2026-11-01");
    expect(periodEnd("2026-10-01", "SemiMonthly")).toBe("2026-10-16");
    expect(periodEnd("2026-10-16", "SemiMonthly")).toBe("2026-11-01");
    expect(periodEnd("2026-10-01", "Weekly")).toBe("2026-10-08");
    expect(periodContaining("2026-01-01", "Monthly", "2026-11-06")).toEqual({ start: "2026-11-01", end: "2026-12-01" });
  });

  it("finds the last closed period (what the scheduler bills)", () => {
    expect(lastClosedPeriod("2026-01-01", "Monthly", "2026-11-06")).toEqual({ start: "2026-10-01", end: "2026-11-01" });
    expect(lastClosedPeriod("2026-11-01", "Monthly", "2026-11-06")).toBeNull();
  });
});

describe("bill status machine", () => {
  it("allows Draft → Approved/Canceled, Approved → Draft/Canceled and nothing out of Canceled", () => {
    expect(canTransitionBill("Draft", "Approved")).toBe(true);
    expect(canTransitionBill("Approved", "Draft")).toBe(true);
    expect(canTransitionBill("Canceled", "Draft")).toBe(false);
    expect(canTransitionBill("Canceled", "Approved")).toBe(false);
  });
});

describe("organization helpers", () => {
  it("keeps one default per usage type (last flagged wins, else first active)", () => {
    const out = normalizeDefaults([
      { usageType: "Shipping", isDefault: true, isActive: true }, { usageType: "Shipping", isDefault: true, isActive: true },
      { usageType: "Billing", isDefault: false, isActive: true }, { usageType: "Return", isDefault: true, isActive: false },
    ]);
    expect(out.map((a) => a.isDefault)).toEqual([false, true, true, false]);
  });

  it("requires an active Shipping address on customers", () => {
    const r = customerSchema.safeParse({ firstName: "A", lastName: "B", email: "a@b.io", phone: "5125550100", clientId: "c", addresses: [{ name: "Office", usageType: "Billing", line1: "1 Main", city: "Austin", state: "TX", postalCode: "78701", country: "US" }] });
    expect(r.error?.issues[0]).toMatchObject({ path: ["addresses"], message: "Add at least one active Shipping address" });
  });

  it("counts the 28 client switches and suggests codes", () => {
    expect(CLIENT_SETTING_COUNT).toBe(28);
    expect(enabledSwitchCount(fullSettings({ packing: { enablePackAll: true }, advanced: { keepPoNumberOnInventory: true } }))).toBe(2);
    expect(suggestClientCode("Copperline Coffee Co.")).toBe("CCCOP");
    expect(suggestClientCode("Harbor")).toBe("HARBOR");
  });

  it("formats money for grids and rails", () => {
    expect(moneyGrid(66.03)).toBe("66.03 USD");
    expect(moneyRail(1340.5)).toBe("$1,340.50");
    expect(moneyRail(-12, "EUR")).toBe("-€12.00");
  });

  it("derives the VAS calculation type and reference order type", () => {
    expect(vasCalculationType({ calculationType: "Total Price" })).toBe("Total Price");
    expect(vasCalculationType(null)).toBe("Vas Quantity");
    expect(referenceTypeOf("SO000123")).toBe("Shipment Order");
    expect(referenceTypeOf("PO000045")).toBe("Purchase Order");
    expect(referenceTypeOf("WO000007")).toBe("Work Order");
    expect(vasSchema.safeParse({ clientId: "c", warehouseId: "w", vasTypeId: "t", operationAt: "2026-11-05T15:00:00Z", value: 2, referenceNumber: "SO1" }).error?.issues[0]?.path).toEqual(["referenceOrderType"]);
    expect(vasSchema.safeParse({ clientId: "c", warehouseId: "w", vasTypeId: "t", operationAt: "2026-11-05T15:00:00Z", value: 2, note: "x".repeat(201) }).success).toBe(false);
    expect(vasSchema.safeParse({ clientId: "c", warehouseId: "w", vasTypeId: "t", operationAt: "2026-11-05T15:00:00Z", value: 2, referenceOrderType: "Shipment Order" }).error?.issues[0]?.path).toEqual(["referenceNumber"]);
    expect(vasSchema.safeParse({ clientId: "c", warehouseId: "w", vasTypeId: "t", operationAt: "2026-11-05T15:00:00Z", value: 2, referenceOrderType: "Work Order", referenceNumber: "W".repeat(100) }).success).toBe(true);
    expect(vasSchema.safeParse({ clientId: "c", warehouseId: "w", vasTypeId: "t", operationAt: "2026-11-05T15:00:00Z", value: 2, referenceOrderType: "Work Order", referenceNumber: "W".repeat(101) }).success).toBe(false);
  });
});

describe("client SSCC-18 settings", () => {
  it("computes the GS1 check digit (GS1 reference example)", () => {
    expect(ssccCheckDigit("00614141123456789")).toBe(0);
    expect(previewSscc({ extensionDigit: "0", gs1CompanyPrefix: "0614141", serialNumber: "123456789" })).toBe("006141411234567890");
  });
  it("pads the serial to 17 digits and leaves blank settings valid", () => {
    expect(previewSscc({ extensionDigit: "1", gs1CompanyPrefix: "0614141", serialNumber: "1" })).toMatch(/^10614141000000001\d$/);
    expect(clientSsccSchema.safeParse({ extensionDigit: "", gs1CompanyPrefix: "", serialNumber: "" }).success).toBe(true);
    expect(previewSscc({})).toBeNull();
  });
  it("requires all three values once one is set and caps the serial by prefix length", () => {
    const partial = clientSsccSchema.safeParse({ extensionDigit: "", gs1CompanyPrefix: "0614141", serialNumber: "" });
    expect(partial.success).toBe(false);
    expect(partial.error?.issues.map((i) => i.path[0]).sort()).toEqual(["extensionDigit", "serialNumber"]);
    expect(clientSsccSchema.safeParse({ extensionDigit: "0", gs1CompanyPrefix: "0614141234", serialNumber: "1234567" }).success).toBe(false);
    expect(clientSsccSchema.safeParse({ extensionDigit: "0", gs1CompanyPrefix: "061414", serialNumber: "1" }).success).toBe(false);
    expect(readSscc({ packing: {}, sscc: { extensionDigit: "2", gs1CompanyPrefix: "0614141", serialNumber: "5" } })).toEqual({ extensionDigit: "2", gs1CompanyPrefix: "0614141", serialNumber: "5" });
    expect(readSscc(null)).toEqual({ extensionDigit: "", gs1CompanyPrefix: "", serialNumber: "" });
  });
});