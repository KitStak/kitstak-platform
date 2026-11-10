/** Round 6: one bill per period (recalc in place), approve guard, legacy bill repair. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { contractSchema, FEE_DEFAULTS, feeSchema } from "@/lib/grid-defs/organization/billing";
import { approveReports, calculateContracts, normalizeBillingReports } from "@/server/repositories/billing-reports";
import { createContract, createFee } from "@/server/repositories/billing";
import { createWorld, type World } from "../foundation/domain/fixtures";

describe("one bill per period", () => {
  let w: World;
  let auth: AuthContext;
  const actor = () => ({ userId: w.userId, source: "Web" });
  const now = new Date("2026-11-06T12:00:00.000Z");
  beforeEach(() => {
    w = createWorld();
    const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
    auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  });
  afterEach(() => w.close());
  const contract = (fees = true) => {
    const c = createContract(w.db, auth, actor(), contractSchema.parse({ name: `C${Math.random()}`, clientId: w.clientId, warehouseId: w.warehouseId, calcStartDate: "2026-10-01", frequency: "Monthly" }));
    if (fees) createFee(w.db, auth, actor(), c.id, feeSchema.parse({ ...FEE_DEFAULTS, name: "Account", operationType: "Recurring", feeBy: "Recurring", chargeBy: "Recurring", tiers: [{ fromQty: 1, toQty: null, rate: 50 }] }));
    return c;
  };
  const bills = () => w.db.select().from(schema.billingReports).all();

  it("recalculates the period's draft in place and never writes a bill for a fee-less contract", () => {
    const c = contract();
    const a = calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: "lastClosed" }, now).reports[0]!;
    const b = calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: "lastClosed", replaceDrafts: true }, now).reports[0]!;
    expect(b.reportId).toBe(a.reportId);
    expect(b.billNumber).toMatch(/^\d{16}$/);
    expect(bills()).toHaveLength(1);
    const empty = contract(false);
    const out = calculateContracts(w.db, auth, actor(), { ids: [empty.id], mode: "lastClosed" }, now);
    expect(out.failed[0]?.message).toMatch(/Add at least one fee/);
    expect(bills()).toHaveLength(1);
  });

  it("repairs legacy period ends and overlapping duplicates without renumbering; blocks approving an overlapped bill", () => {
    const c = contract();
    const first = calculateContracts(w.db, auth, actor(), { ids: [c.id], mode: "lastClosed" }, now).reports[0]!;
    const row = w.db.select().from(schema.billingReports).where(eq(schema.billingReports.id, first.reportId)).get()!;
    const { id: _id, ...copy } = row;
    void _id;
    // Legacy rows predate the DB guard: drop the triggers to recreate them.
    w.t.sqlite.exec("DROP TRIGGER IF EXISTS billing_reports_period_guard_ins; DROP TRIGGER IF EXISTS billing_reports_period_guard_upd;");
    w.db.insert(schema.billingReports).values({ ...copy, billNumber: "261110001", periodEnd: "2026-11-01T23:59:59.999Z", calculatedAt: "2026-11-01T00:00:00.000Z" }).run();
    w.db.insert(schema.billingReports).values({ ...copy, billNumber: "261110002", calculatedAt: "2026-11-02T00:00:00.000Z" }).run();
    const dup = bills().find((x) => x.billNumber === "261110002")!;
    expect(approveReports(w.db, auth, actor(), [dup.id], { now }).failed[0]?.message).toMatch(/would bill the period twice/);
    const fix = normalizeBillingReports(w.db, now);
    expect(fix).toMatchObject({ renumbered: 0, periodFixed: 1, canceled: 2 });
    const all = bills();
    // Issued numbers are never rewritten.
    expect(all.map((x) => x.billNumber).sort()).toEqual([first.billNumber, "261110001", "261110002"].sort());
    expect(all.every((x) => x.periodEnd.startsWith("2026-10-31"))).toBe(true);
    expect(all.filter((x) => x.billStatus !== "Canceled").map((x) => x.id)).toEqual([first.reportId]);
    expect(approveReports(w.db, auth, actor(), [first.reportId], { now }).succeeded).toEqual([first.reportId]);
    expect(normalizeBillingReports(w.db, now)).toEqual({ renumbered: 0, periodFixed: 0, canceled: 0, deleted: 0 });
  });
});
