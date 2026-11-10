/**
 * Round 10 (parity loop, critic R4 5.5): one-time recurring fees bill exactly once on the live bill
 * (recalculating a Draft in place and canceling a bill both re-bill it), only one Approved contract
 * per client and warehouse, schedule fields lock once bills exist, VAS changes mark Draft bills
 * outdated, and VAS validation reports every field error at once.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { AppError } from "@/server/api/errors";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { contractSchema, FEE_DEFAULTS, feeSchema } from "@/lib/grid-defs/organization/billing";
import { vasSchema } from "@/lib/grid-defs/organization/vas";
import { calculateContracts, cancelReports, getReport, listReports } from "@/server/repositories/billing-reports";
import { approveContracts, createContract, createFee, duplicateContracts, getContract, updateContract } from "@/server/repositories/billing";
import { createVas, deleteVas, listVas, updateVas } from "@/server/repositories/vas";
import { createWorld, type World } from "../foundation/domain/fixtures";

describe("billing round 10", () => {
  let w: World;
  let auth: AuthContext;
  const actor = () => ({ userId: w.userId, source: "Web" });
  beforeEach(() => {
    w = createWorld();
    const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
    auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  });
  afterEach(() => w.close());

  const recurring = (contractId: string, name: string, rate: number, chargeOneTime = false) =>
    createFee(w.db, auth, actor(), contractId, feeSchema.parse({ ...FEE_DEFAULTS, name, operationType: "Recurring", feeBy: "Recurring", chargeBy: "Recurring", chargeOneTime, tiers: [{ fromQty: 1, toQty: null, rate }] }));
  const contract = (name = `C${Math.random()}`, calcStartDate = "2026-11-01") =>
    createContract(w.db, auth, actor(), contractSchema.parse({ name, clientId: w.clientId, warehouseId: w.warehouseId, calcStartDate, frequency: "Monthly" }));
  const at = (h: number) => new Date(`2026-11-10T${String(h).padStart(2, "0")}:00:00.000Z`);

  describe("Charge one time", () => {
    it("survives recalculating the Draft bill in place", () => {
      const c = contract();
      recurring(c.id, "Onboarding", 100, true);
      recurring(c.id, "Account", 50);
      const first = calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: "current" }, at(15));
      expect(first.reports[0]?.totalPrice).toBe(150);
      const again = calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: "current", replaceDrafts: true }, at(16));
      expect(again.reports[0]?.reportId).toBe(first.reports[0]?.reportId);
      expect(again.reports[0]?.totalPrice).toBe(150);
    });

    it("is billed again once its only bill was canceled", () => {
      const c = contract();
      recurring(c.id, "Onboarding", 100, true);
      const a = calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: "current" }, at(15));
      cancelReports(w.db, auth, actor(), [a.reports[0]!.reportId]);
      const b = calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: "current" }, at(16));
      expect(b.reports[0]?.totalPrice).toBe(100);
    });

    it("is not billed a second time on the next period's bill", () => {
      const c = contract("Next", "2026-10-01");
      recurring(c.id, "Onboarding", 100, true);
      recurring(c.id, "Account", 50);
      const oct = calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: "custom", start: "2026-10-01", end: "2026-10-31" }, at(15));
      expect(oct.reports[0]?.totalPrice).toBe(150);
      const nov = calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: "current" }, at(16));
      expect(nov.reports[0]?.totalPrice).toBe(50);
      const note = getReport(w.db, auth, nov.reports[0]!.reportId).consolidated.find((l) => l.feeName === "Onboarding")?.note;
      expect(note).toBe("One-time fee already billed");
    });
  });

  describe("approval governance", () => {
    it("refuses a second Approved contract for the same client and warehouse", () => {
      const a = contract("Original");
      recurring(a.id, "Account", 50);
      expect(approveContracts(w.db, auth, actor(), [a.id]).succeeded).toEqual([a.id]);
      const dup = duplicateContracts(w.db, auth, actor(), [a.id]);
      const copy = dup.created[0]!;
      expect(dup.warnings[0]).toMatch(/stays approved/);
      const r = approveContracts(w.db, auth, actor(), [copy.id]);
      expect(r.succeeded).toEqual([]);
      expect(r.failed[0]?.message).toMatch(/already approved for this client and warehouse/);
    });

    it("refuses both when two drafts are approved in one bulk action", () => {
      const a = contract("A"); recurring(a.id, "Account", 50);
      const b = contract("B"); recurring(b.id, "Account", 50);
      const r = approveContracts(w.db, auth, actor(), [a.id, b.id]);
      expect(r.succeeded).toEqual([a.id]);
      expect(r.failed.map((f) => f.id)).toEqual([b.id]);
    });
  });

  describe("schedule lock", () => {
    it("locks calc start date and frequency once a live bill exists, and unlocks after canceling it", () => {
      const c = contract();
      recurring(c.id, "Account", 50);
      const bill = calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: "current" }, at(15)).reports[0]!;
      const base = getContract(w.db, auth, c.id);
      const input = (patch: Record<string, unknown>) => contractSchema.parse({ name: base.name, clientId: base.clientId, warehouseId: base.warehouseId, calcStartDate: base.calcStartDate, frequency: base.frequency, version: base.version, ...patch });
      let err: unknown;
      try { updateContract(w.db, auth, actor(), c.id, input({ frequency: "BiWeekly" })); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).fieldErrors).toMatchObject({ frequency: ["Locked: this contract already has bills"] });
      expect(() => updateContract(w.db, auth, actor(), c.id, input({ calcStartDate: "2026-11-05" }))).toThrow(/locked once bills exist/);
      // Renaming stays allowed.
      expect(updateContract(w.db, auth, actor(), c.id, input({ name: "Renamed" })).name).toBe("Renamed");
      cancelReports(w.db, auth, actor(), [bill.reportId]);
      const fresh = getContract(w.db, auth, c.id);
      expect(updateContract(w.db, auth, actor(), c.id, contractSchema.parse({ name: fresh.name, clientId: fresh.clientId, warehouseId: fresh.warehouseId, calcStartDate: fresh.calcStartDate, frequency: "BiWeekly", version: fresh.version })).id).toBe(c.id);
    });
  });

  describe("VAS and Draft bills", () => {
    const vasType = () => w.db.insert(schema.lookupValues).values({ type: "vas_type", name: "Kitting (hours)", meta: { calculationType: "Vas Quantity" } }).returning().get().id;

    it("marks the Draft bill outdated on create, edit and delete; recalculation clears it", () => {
      const c = contract();
      recurring(c.id, "Account", 50);
      const now = new Date(Date.now() - 60_000);
      const bill = calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: "current" }, now).reports[0]!;
      const day = getReport(w.db, auth, bill.reportId).periodStart.slice(0, 10);
      expect(getReport(w.db, auth, bill.reportId).outdatedReason).toBeNull();
      const typeId = vasType();
      const created = createVas(w.db, auth, actor(), vasSchema.parse({ clientId: w.clientId, warehouseId: w.warehouseId, vasTypeId: typeId, operationAt: `${day}T15:00:00.000Z`, value: 2 }));
      expect(created.outdatedBills).toEqual([bill.billNumber]);
      expect(getReport(w.db, auth, bill.reportId).outdatedReason).toMatch(/^Outdated: VAS operation .* added after calculation/);
      expect(listReports(w.db, auth, EMPTY_GRID_QUERY).rows.find((r) => r.id === bill.reportId)?.outdatedReason).toBeTruthy();
      const row = listVas(w.db, auth, EMPTY_GRID_QUERY).rows.find((r) => r.id === created.id)!;
      expect(row.draftIn).toBe(bill.billNumber);
      const upd = updateVas(w.db, auth, actor(), created.id, vasSchema.parse({ clientId: w.clientId, warehouseId: w.warehouseId, vasTypeId: typeId, operationAt: `${day}T15:00:00.000Z`, value: 3, version: row.version }));
      expect(upd.outdatedBills).toEqual([bill.billNumber]);
      // Recalculating in place clears the marker.
      calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: "current", replaceDrafts: true }, new Date(Date.now() + 1_000));
      expect(getReport(w.db, auth, bill.reportId).outdatedReason).toBeNull();
      deleteVas(w.db, auth, actor(), [created.id]);
      const log = w.db.select().from(schema.changeLog).all().filter((e) => e.entityId === bill.reportId && e.field === "outdated");
      expect(log.at(-1)?.toValue).toMatch(/deleted$/);
    });

    it("returns every field error in one response", () => {
      let err: unknown;
      try {
        createVas(w.db, auth, actor(), vasSchema.parse({ clientId: w.clientId, warehouseId: w.warehouseId, vasTypeId: "x", operationAt: "2026-11-05T15:00:00.000Z", value: 1, referenceOrderType: "Shipment Order", referenceNumber: "SO-NOPE" }));
      } catch (e) { err = e; }
      expect(err).toBeInstanceOf(AppError);
      const fieldErrors = (err as AppError).fieldErrors ?? {};
      expect(Object.keys(fieldErrors).sort()).toEqual(["referenceNumber", "vasTypeId"]);
      expect((err as AppError).message).toBe("2 fields need attention");
    });
  });
});
