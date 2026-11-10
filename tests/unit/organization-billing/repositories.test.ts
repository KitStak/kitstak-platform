/** M11 repositories against an in-memory DB: clients, customers, retailers, contracts, fees, engine, bills, VAS, scheduler. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { CLIENT_DEFAULTS, clientSchema } from "@/lib/grid-defs/organization/clients";
import { customerSchema } from "@/lib/grid-defs/organization/customers";
import { RETAILER_DEFAULTS, retailerSchema } from "@/lib/grid-defs/organization/retailers";
import { contractSchema, feeSchema, FEE_DEFAULTS } from "@/lib/grid-defs/organization/billing";
import { vasSchema } from "@/lib/grid-defs/organization/vas";
import { clientDeleteBlocker, createClient, getClient, listClients, setClientStatus, updateClientSettings } from "@/server/repositories/clients";
import { createCustomer, deleteCustomers, listCustomers } from "@/server/repositories/customers";
import { createRetailer, deleteRetailers, getRetailer, listRetailers } from "@/server/repositories/retailers";
import { approveContracts, createContract, createFee, deleteContracts, duplicateContracts, getContract } from "@/server/repositories/billing";
import { approveReports, autoCalculateDue, calculateContracts, deleteReports, getReport } from "@/server/repositories/billing-reports";
import { createVas, deleteVas, vasTypes } from "@/server/repositories/vas";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
const actor = () => ({ userId: w.userId, source: "Web" });

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const address = { name: "Main dock", usageType: "Shipping" as const, firstName: "Dana", lastName: "Ruiz", email: "dock@example.com", line1: "100 Congress Ave", city: "Austin", state: "TX", postalCode: "78701", country: "US", isDefault: true, isActive: true };
const logsOf = (id: string) => w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, id)).all();

describe("clients", () => {
  it("creates KS-E2E Client with 3 switches + default shipping address, KPIs at 0, and drops out of wizard selects when inactive", () => {
    const input = clientSchema.parse({
      ...CLIENT_DEFAULTS, name: "KS-E2E Client", code: "KSE2E", officialName: "KS-E2E Client LLC",
      settings: { notifications: { receivedPo: true }, fulfillment: {}, packing: { enablePackAll: true }, advanced: { keepPoNumberOnInventory: true } }, addresses: [address],
    });
    const { id } = createClient(w.db, auth, actor(), input);
    const d = getClient(w.db, auth, id);
    expect(d.settings.packing.enablePackAll).toBe(true);
    expect(d.addresses).toHaveLength(1);
    expect(d.addresses[0]).toMatchObject({ usageType: "Shipping", isDefault: true, country: "US" });
    expect(d.kpis).toMatchObject({ orders30d: 0, unitsShipped30d: 0, inventoryUnits: 0, openPos: 0 });
    expect(logsOf(id).map((l) => l.type)).toContain("Create");

    const picker = { ...EMPTY_GRID_QUERY, filters: [{ field: "warehouseId", op: "in", value: [w.warehouseId] }] } as unknown as typeof EMPTY_GRID_QUERY;
    expect(listClients(w.db, auth, picker).rows.map((r) => r.code)).toContain("KSE2E");
    expect(setClientStatus(w.db, auth, actor(), [id], "Inactive").succeeded).toEqual([id]);
    expect(listClients(w.db, auth, picker).rows.map((r) => r.code)).not.toContain("KSE2E");
    expect(listClients(w.db, auth, EMPTY_GRID_QUERY).rows.map((r) => r.code)).toContain("KSE2E");
  });

  it("stores SSCC-18 settings, keeps them through a settings-only edit and logs them", () => {
    const sscc = { extensionDigit: "1", gs1CompanyPrefix: "0614141", serialNumber: "42" };
    const { id } = createClient(w.db, auth, actor(), clientSchema.parse({ ...CLIENT_DEFAULTS, name: "Sscc Co", code: "SSCC", officialName: "Sscc Co LLC", sscc }));
    expect(getClient(w.db, auth, id).sscc).toEqual(sscc);
    const d = getClient(w.db, auth, id);
    updateClientSettings(w.db, auth, actor(), id, { currency: "EUR", settings: { ...d.settings, packing: { ...d.settings.packing, enablePackAll: true } }, version: d.version });
    const after = getClient(w.db, auth, id);
    expect(after.sscc).toEqual(sscc);
    expect(after.settings.packing.enablePackAll).toBe(true);
    expect(after.currency).toBe("EUR");
  });

  it("rejects duplicate codes and stale versions, and guards deletes", () => {
    const input = clientSchema.parse({ ...CLIENT_DEFAULTS, name: "Dup Co", code: "DUP", officialName: "Dup Co LLC" });
    const { id } = createClient(w.db, auth, actor(), input);
    expect(() => createClient(w.db, auth, actor(), clientSchema.parse({ ...CLIENT_DEFAULTS, name: "Other", code: "DUP", officialName: "Other" }))).toThrow(/already used/);
    expect(() => updateClientSettings(w.db, auth, actor(), id, { currency: "EUR", settings: getClient(w.db, auth, id).settings, version: 99 })).toThrow();
    expect(clientDeleteBlocker(w.db, w.clientId)).toMatch(/products/);
    expect(clientDeleteBlocker(w.db, id)).toBeNull();
  });
});

describe("customers and retailers", () => {
  it("creates a customer with addresses and deletes it when no orders reference it", () => {
    const { id } = createCustomer(w.db, auth, actor(), customerSchema.parse({ firstName: "Jamie", lastName: "Rivera", email: "jamie@example.com", phone: "(512) 555-0142", clientId: w.clientId, addresses: [address] }));
    const row = listCustomers(w.db, auth, EMPTY_GRID_QUERY).rows.find((r) => r.id === id);
    expect(row).toMatchObject({ fullName: "Jamie Rivera", city: "Austin", state: "TX", isActive: true });
    expect(() => createCustomer(w.db, auth, actor(), customerSchema.parse({ firstName: "J", lastName: "R", email: "JAMIE@example.com", phone: "(512) 555-0142", clientId: w.clientId, addresses: [address] }))).toThrow(/already a customer/);
    expect(deleteCustomers(w.db, auth, actor(), [id]).succeeded).toEqual([id]);
  });

  it("creates a retailer with an address and case-label settings", () => {
    const { id } = createRetailer(w.db, auth, actor(), retailerSchema.parse({ ...RETAILER_DEFAULTS, name: "Target", line1: "1000 Nicollet Mall", city: "Minneapolis", state: "MN", postalCode: "55403", createCaseLabels: true, caseLabelPrintQty: 2 }));
    expect(getRetailer(w.db, id)).toMatchObject({ name: "Target", createCaseLabels: true, caseLabelPrintQty: 2, city: "Minneapolis", countryCode: "US" });
    expect(listRetailers(w.db, auth, EMPTY_GRID_QUERY).rows[0]?.address).toContain("Minneapolis");
    expect(deleteRetailers(w.db, auth, actor(), [id]).succeeded).toEqual([id]);
  });
});

describe("3PL billing contracts, engine and bills", () => {
  const setup = () => {
    const vasType = w.db.insert(schema.lookupValues).values({ type: "vas_type", name: "Programming (hours)", meta: { calculationType: "Vas Quantity" } }).returning().get().id;
    const contract = createContract(w.db, auth, actor(), contractSchema.parse({ name: "ACME 3PL 2026", clientId: w.clientId, warehouseId: w.warehouseId, calcStartDate: "2026-10-01", frequency: "Monthly" }));
    createFee(w.db, auth, actor(), contract.id, feeSchema.parse({ ...FEE_DEFAULTS, name: "Monthly account fee", operationType: "Recurring", feeBy: "Recurring", chargeBy: "Recurring", tiers: [{ fromQty: 1, toQty: null, rate: 50 }] }));
    createFee(w.db, auth, actor(), contract.id, feeSchema.parse({ ...FEE_DEFAULTS, name: "Programming", operationType: "VAS", feeBy: "Operation", chargeBy: "Operation Value", vasTypeId: vasType, pricingMode: "graduated", tiers: [{ fromQty: 1, toQty: 100, rate: 3 }, { fromQty: 101, toQty: null, rate: 2.5 }] }));
    return { contract, vasType };
  };

  it("bills recurring + VAS × 2 with a numbered bill, then approval locks deletion", () => {
    const { contract, vasType } = setup();
    expect(vasTypes(w.db, auth).map((t) => t.name)).toEqual(["Programming (hours)"]);
    const base = { clientId: w.clientId, warehouseId: w.warehouseId, vasTypeId: vasType, operationAt: "2026-10-15T15:00:00.000Z", value: 2 };
    expect(() => createVas(w.db, auth, actor(), vasSchema.parse({ ...base, referenceNumber: "SO-MISSING", referenceOrderType: "Shipment Order" }))).toThrow(/does not exist/);
    createVas(w.db, auth, actor(), vasSchema.parse({ ...base, note: "VAS-NOTE-1" }));
    const now = new Date("2026-11-06T12:00:00.000Z");
    const out = calculateContracts(w.db, auth, actor(), { ids: [contract.id], mode: "lastClosed" }, now);
    const bill = out.reports[0]!;
    expect(bill.status).toBe("Successful");
    expect(bill.billNumber).toMatch(/^261106\d+$/);
    expect(bill.totalPrice).toBe(56);
    const detail = getReport(w.db, auth, bill.reportId);
    expect(detail.consolidated.map((l) => [l.feeName, l.quantity, l.adjustedPrice])).toEqual(expect.arrayContaining([["Monthly account fee", 1, 50], ["Programming", 2, 6]]));
    const lines = w.db.select().from(schema.billingReportLines).where(eq(schema.billingReportLines.reportId, bill.reportId)).all();
    expect(lines.filter((l) => l.isDetail).length).toBeGreaterThan(0);

    expect(approveReports(w.db, auth, actor(), [bill.reportId]).succeeded).toEqual([bill.reportId]);
    expect(deleteReports(w.db, auth, actor(), [bill.reportId]).failed[0]?.message).toMatch(/only draft bills/);
    const vasId = w.db.select().from(schema.vasOperations).get()!.id;
    expect(deleteVas(w.db, auth, actor(), [vasId]).failed[0]?.message).toMatch(/approved bill/);
  });

  it("records a failed calculation with its error and guards approve / delete of contracts", () => {
    const empty = createContract(w.db, auth, actor(), contractSchema.parse({ name: "Empty", clientId: w.clientId, warehouseId: w.warehouseId, calcStartDate: "2026-10-01", frequency: "Monthly" }));
    expect(approveContracts(w.db, auth, actor(), [empty.id]).failed[0]?.message).toMatch(/at least one fee/);
    // Round 5: a fee-less contract is refused before anything is written (no junk Failed bill), and never blocks delete.
    const out = calculateContracts(w.db, auth, actor(), { ids: [empty.id], mode: "lastClosed" }, new Date("2026-11-06T12:00:00.000Z"));
    expect(out.reports).toHaveLength(0);
    expect(out.failed[0]?.message).toMatch(/has no fees/);
    expect(w.db.select().from(schema.billingReports).where(eq(schema.billingReports.contractId, empty.id)).all()).toHaveLength(0);
    expect(deleteContracts(w.db, auth, actor(), [empty.id]).succeeded).toEqual([empty.id]);

    const { contract } = setup();
    const copy = duplicateContracts(w.db, auth, actor(), [contract.id]).created[0]!;
    expect(copy.name).toBe("ACME 3PL 2026 (copy)");
    expect(getContract(w.db, auth, copy.id).fees).toHaveLength(2);
    expect(approveContracts(w.db, auth, actor(), [contract.id]).succeeded).toEqual([contract.id]);
    expect(() => createFee(w.db, auth, actor(), contract.id, feeSchema.parse({ ...FEE_DEFAULTS, tiers: [{ fromQty: 1, toQty: null, rate: 1 }], name: "Late", operationType: "Recurring", feeBy: "Recurring", chargeBy: "Recurring" }))).toThrow(/Cancel the approval/);
  });

  it("scheduler bills each approved contract once per closed period", () => {
    const { contract } = setup();
    approveContracts(w.db, auth, actor(), [contract.id]);
    const now = new Date("2026-11-06T12:00:00.000Z");
    expect(autoCalculateDue(w.db, now)).toMatchObject({ calculated: 1, failed: 0 });
    expect(autoCalculateDue(w.db, now)).toMatchObject({ calculated: 0, skipped: 1 });
  });
});
