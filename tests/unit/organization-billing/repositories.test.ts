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

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const address = { name: "Main dock", usageType: "Shipping" as const, firstName: "Dana", lastName: "Ruiz", email: "dock@example.com", line1: "100 Congress Ave", city: "Austin", state: "TX", postalCode: "78701", country: "US", isDefault: true, isActive: true };
const logsOf = async (id: string) => await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, id));

describe("clients", () => {
  it("creates KS-E2E Client with 3 switches + default shipping address, KPIs at 0, and drops out of wizard selects when inactive", async () => {
    const input = clientSchema.parse({
      ...CLIENT_DEFAULTS, name: "KS-E2E Client", code: "KSE2E", officialName: "KS-E2E Client LLC",
      settings: { notifications: { receivedPo: true }, fulfillment: {}, packing: { enablePackAll: true }, advanced: { keepPoNumberOnInventory: true } }, addresses: [address],
    });
    const { id } = await createClient(w.db, auth, actor(), input);
    const d = await getClient(w.db, auth, id);
    expect(d.settings.packing.enablePackAll).toBe(true);
    expect(d.addresses).toHaveLength(1);
    expect(d.addresses[0]).toMatchObject({ usageType: "Shipping", isDefault: true, country: "US" });
    expect(d.kpis).toMatchObject({ orders30d: 0, unitsShipped30d: 0, inventoryUnits: 0, openPos: 0 });
    expect((await logsOf(id)).map((l) => l.type)).toContain("Create");

    const picker = { ...EMPTY_GRID_QUERY, filters: [{ field: "warehouseId", op: "in", value: [w.warehouseId] }] } as unknown as typeof EMPTY_GRID_QUERY;
    expect((await listClients(w.db, auth, picker)).rows.map((r) => r.code)).toContain("KSE2E");
    expect((await setClientStatus(w.db, auth, actor(), [id], "Inactive")).succeeded).toEqual([id]);
    expect((await listClients(w.db, auth, picker)).rows.map((r) => r.code)).not.toContain("KSE2E");
    expect((await listClients(w.db, auth, EMPTY_GRID_QUERY)).rows.map((r) => r.code)).toContain("KSE2E");
  });

  it("stores SSCC-18 settings, keeps them through a settings-only edit and logs them", async () => {
    const sscc = { extensionDigit: "1", gs1CompanyPrefix: "0614141", serialNumber: "42" };
    const { id } = await createClient(w.db, auth, actor(), clientSchema.parse({ ...CLIENT_DEFAULTS, name: "Sscc Co", code: "SSCC", officialName: "Sscc Co LLC", sscc }));
    expect((await getClient(w.db, auth, id)).sscc).toEqual(sscc);
    const d = await getClient(w.db, auth, id);
    await updateClientSettings(w.db, auth, actor(), id, { currency: "EUR", settings: { ...d.settings, packing: { ...d.settings.packing, enablePackAll: true } }, version: d.version });
    const after = await getClient(w.db, auth, id);
    expect(after.sscc).toEqual(sscc);
    expect(after.settings.packing.enablePackAll).toBe(true);
    expect(after.currency).toBe("EUR");
  });

  it("rejects duplicate codes and stale versions, and guards deletes", async () => {
    const input = clientSchema.parse({ ...CLIENT_DEFAULTS, name: "Dup Co", code: "DUP", officialName: "Dup Co LLC" });
    const { id } = await createClient(w.db, auth, actor(), input);
    await expect(async () => await createClient(w.db, auth, actor(), clientSchema.parse({ ...CLIENT_DEFAULTS, name: "Other", code: "DUP", officialName: "Other" }))).rejects.toThrow(/already used/);
    await expect(async () => await updateClientSettings(w.db, auth, actor(), id, { currency: "EUR", settings: (await getClient(w.db, auth, id)).settings, version: 99 })).rejects.toThrow();
    expect(await clientDeleteBlocker(w.db, w.clientId)).toMatch(/products/);
    expect(await clientDeleteBlocker(w.db, id)).toBeNull();
  });
});

describe("customers and retailers", () => {
  it("creates a customer with addresses and deletes it when no orders reference it", async () => {
    const { id } = await createCustomer(w.db, auth, actor(), customerSchema.parse({ firstName: "Jamie", lastName: "Rivera", email: "jamie@example.com", phone: "(512) 555-0142", clientId: w.clientId, addresses: [address] }));
    const row = (await listCustomers(w.db, auth, EMPTY_GRID_QUERY)).rows.find((r) => r.id === id);
    expect(row).toMatchObject({ fullName: "Jamie Rivera", city: "Austin", state: "TX", isActive: true });
    await expect(async () => await createCustomer(w.db, auth, actor(), customerSchema.parse({ firstName: "J", lastName: "R", email: "JAMIE@example.com", phone: "(512) 555-0142", clientId: w.clientId, addresses: [address] }))).rejects.toThrow(/already a customer/);
    expect((await deleteCustomers(w.db, auth, actor(), [id])).succeeded).toEqual([id]);
  });

  it("creates a retailer with an address and case-label settings", async () => {
    const { id } = await createRetailer(w.db, auth, actor(), retailerSchema.parse({ ...RETAILER_DEFAULTS, name: "Target", line1: "1000 Nicollet Mall", city: "Minneapolis", state: "MN", postalCode: "55403", createCaseLabels: true, caseLabelPrintQty: 2 }));
    expect(await getRetailer(w.db, id)).toMatchObject({ name: "Target", createCaseLabels: true, caseLabelPrintQty: 2, city: "Minneapolis", countryCode: "US" });
    expect((await listRetailers(w.db, auth, EMPTY_GRID_QUERY)).rows[0]?.address).toContain("Minneapolis");
    expect((await deleteRetailers(w.db, auth, actor(), [id])).succeeded).toEqual([id]);
  });
});

describe("3PL billing contracts, engine and bills", () => {
  const setup = async () => {
    const vasType = (await w.db.insert(schema.lookupValues).values({ type: "vas_type", name: "Programming (hours)", meta: { calculationType: "Vas Quantity" } }).returning())[0].id;
    const contract = await createContract(w.db, auth, actor(), contractSchema.parse({ name: "ACME 3PL 2026", clientId: w.clientId, warehouseId: w.warehouseId, calcStartDate: "2026-10-01", frequency: "Monthly" }));
    await createFee(w.db, auth, actor(), contract.id, feeSchema.parse({ ...FEE_DEFAULTS, name: "Monthly account fee", operationType: "Recurring", feeBy: "Recurring", chargeBy: "Recurring", tiers: [{ fromQty: 1, toQty: null, rate: 50 }] }));
    await createFee(w.db, auth, actor(), contract.id, feeSchema.parse({ ...FEE_DEFAULTS, name: "Programming", operationType: "VAS", feeBy: "Operation", chargeBy: "Operation Value", vasTypeId: vasType, pricingMode: "graduated", tiers: [{ fromQty: 1, toQty: 100, rate: 3 }, { fromQty: 101, toQty: null, rate: 2.5 }] }));
    return { contract, vasType };
  };

  it("bills recurring + VAS × 2 with a numbered bill, then approval locks deletion", async () => {
    const { contract, vasType } = await setup();
    expect((await vasTypes(w.db, auth)).map((t) => t.name)).toEqual(["Programming (hours)"]);
    const base = { clientId: w.clientId, warehouseId: w.warehouseId, vasTypeId: vasType, operationAt: "2026-10-15T15:00:00.000Z", value: 2 };
    await expect(async () => await createVas(w.db, auth, actor(), vasSchema.parse({ ...base, referenceNumber: "SO-MISSING", referenceOrderType: "Shipment Order" }))).rejects.toThrow(/does not exist/);
    await createVas(w.db, auth, actor(), vasSchema.parse({ ...base, note: "VAS-NOTE-1" }));
    const now = new Date("2026-11-06T12:00:00.000Z");
    const out = await calculateContracts(w.db, auth, actor(), { ids: [contract.id], mode: "lastClosed" }, now);
    const bill = out.reports[0]!;
    expect(bill.status).toBe("Successful");
    expect(bill.billNumber).toMatch(/^261106\d+$/);
    expect(bill.totalPrice).toBe(56);
    const detail = await getReport(w.db, auth, bill.reportId);
    expect(detail.consolidated.map((l) => [l.feeName, l.quantity, l.adjustedPrice])).toEqual(expect.arrayContaining([["Monthly account fee", 1, 50], ["Programming", 2, 6]]));
    const lines = await w.db.select().from(schema.billingReportLines).where(eq(schema.billingReportLines.reportId, bill.reportId));
    expect(lines.filter((l) => l.isDetail).length).toBeGreaterThan(0);

    expect((await approveReports(w.db, auth, actor(), [bill.reportId])).succeeded).toEqual([bill.reportId]);
    expect((await deleteReports(w.db, auth, actor(), [bill.reportId])).failed[0]?.message).toMatch(/only draft bills/);
    const vasId = (await w.db.select().from(schema.vasOperations).limit(1))[0]!.id;
    expect((await deleteVas(w.db, auth, actor(), [vasId])).failed[0]?.message).toMatch(/approved bill/);
  });

  it("records a failed calculation with its error and guards approve / delete of contracts", async () => {
    const empty = await createContract(w.db, auth, actor(), contractSchema.parse({ name: "Empty", clientId: w.clientId, warehouseId: w.warehouseId, calcStartDate: "2026-10-01", frequency: "Monthly" }));
    expect((await approveContracts(w.db, auth, actor(), [empty.id])).failed[0]?.message).toMatch(/at least one fee/);
    // Round 5: a fee-less contract is refused before anything is written (no junk Failed bill), and never blocks delete.
    const out = await calculateContracts(w.db, auth, actor(), { ids: [empty.id], mode: "lastClosed" }, new Date("2026-11-06T12:00:00.000Z"));
    expect(out.reports).toHaveLength(0);
    expect(out.failed[0]?.message).toMatch(/has no fees/);
    expect(await w.db.select().from(schema.billingReports).where(eq(schema.billingReports.contractId, empty.id))).toHaveLength(0);
    expect((await deleteContracts(w.db, auth, actor(), [empty.id])).succeeded).toEqual([empty.id]);

    const { contract } = await setup();
    const copy = (await duplicateContracts(w.db, auth, actor(), [contract.id])).created[0]!;
    expect(copy.name).toBe("ACME 3PL 2026 (copy)");
    expect((await getContract(w.db, auth, copy.id)).fees).toHaveLength(2);
    expect((await approveContracts(w.db, auth, actor(), [contract.id])).succeeded).toEqual([contract.id]);
    await expect(async () => await createFee(w.db, auth, actor(), contract.id, feeSchema.parse({ ...FEE_DEFAULTS, tiers: [{ fromQty: 1, toQty: null, rate: 1 }], name: "Late", operationType: "Recurring", feeBy: "Recurring", chargeBy: "Recurring" }))).rejects.toThrow(/Cancel the approval/);
  });

  it("scheduler bills each approved contract once per closed period", async () => {
    const { contract } = await setup();
    await approveContracts(w.db, auth, actor(), [contract.id]);
    const now = new Date("2026-11-06T12:00:00.000Z");
    expect(await autoCalculateDue(w.db, now)).toMatchObject({ calculated: 1, failed: 0 });
    expect(await autoCalculateDue(w.db, now)).toMatchObject({ calculated: 0, skipped: 1 });
  });
});
