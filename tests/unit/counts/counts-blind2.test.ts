/** Blind round 2: recount link on Location / SKU Details, default count job type, recount rule, plan lock. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { ledger } from "@/server/domain/ledger";
import { countJobTypes, createCountJobs, createRecounts, ensureDefaultCountJobType } from "@/server/repositories/counts-jobs";
import { listCountLines } from "@/server/repositories/counts-lines";
import { planLockedReason } from "@/lib/grid-defs/counts/count-math";
import { createCountPlan } from "@/server/repositories/counts-plans";
import { countSheet, submitSheetLine } from "@/server/repositories/counts-sheet";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
let cycleType: string;
let rid: string;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(["inventory.count_plans.delete"]), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  rid = w.db.insert(schema.lookupValues).values({ type: "adjustment_reason", name: "Count variance" }).returning().get().id;
  cycleType = w.db.insert(schema.jobTypes).values({
    code: "Cycle Count", description: "Cycle Count", warehouseId: w.warehouseId, operationType: "Count", settings: jobTypeSettingsSchema.parse({ count: {} }),
  }).returning().get().id;
});
afterEach(() => w.close());

const linesOf = (id: string) => w.db.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, id)).all();

function setup() {
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 20 });
  const p = createCountPlan(w.db, w.ctx, auth, {
    code: "KS-REQ16", warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: false,
    countType: "SKU", locationIds: [], productIds: [w.productId],
  });
  createCountJobs(w.db, w.ctx, auth, { ids: [p.id], jobTypeId: cycleType, batchSize: 1, assigneeUserId: null });
  const line = linesOf(p.id)[0];
  if (!line) throw new Error("line");
  const sheet = countSheet(w.db, auth.scope, p.id).find((l) => l.lineId === line.id);
  submitSheetLine(w.db, w.ctx, auth, p.id, { lineId: line.id, entries: (sheet?.buckets ?? []).map((b) => ({ inventoryId: b.inventoryId, countedQty: 17 })), note: null });
  const rc = createRecounts(w.db, w.ctx, auth, [line.id]);
  expect(rc.failed).toEqual([]);
  const recount = linesOf(p.id).find((l) => l.isRecountLine);
  if (!recount) throw new Error("recount");
  return { p, line, recount, jobId: rc.jobIds[0] ?? "" };
}

const q = { qm: "contains" as const, filters: [], sort: [], page: 1, pageSize: 100 };

describe("recount link on the line grids", () => {
  it("the original line links the recount job; the recount line names the original job", () => {
    const { line, recount } = setup();
    for (const kind of ["skus", "locations"] as const) {
      const rows = listCountLines(w.db as never, auth.scope, kind, q as never).rows as unknown as Record<string, unknown>[];
      if (kind === "locations" && rows.length === 0) continue; // SKU plans list on SKU Details only
      const orig = rows.find((r) => (r.lineId ?? r.id) === line.id);
      const rc = rows.find((r) => (r.lineId ?? r.id) === recount.id);
      expect(orig?.recounted).toBe(true);
      expect(orig?.recountJobId).toBe(recount.jobId);
      expect(typeof orig?.recountJobCode).toBe("string");
      expect(orig?.recountLineStatus).toBe(recount.status);
      expect(rc?.isRecountLine).toBe(true);
      expect(rc?.recountOfJobCode).toBeTruthy();
    }
  });
});

describe("default count job type", () => {
  it("creates one Cycle Count type when none is active, and is idempotent", () => {
    w.db.update(schema.jobTypes).set({ isActive: false }).where(eq(schema.jobTypes.id, cycleType)).run();
    expect(countJobTypes(w.db, w.warehouseId)).toEqual([]);
    const a = ensureDefaultCountJobType(w.db, w.ctx, auth, w.warehouseId);
    expect(a.code).toBe("Cycle Count 2");
    expect(a.autoUpdateNoDifference).toBe(true);
    const b = ensureDefaultCountJobType(w.db, w.ctx, auth, w.warehouseId);
    expect(b.id).toBe(a.id);
  });
  it("refuses a warehouse outside the scope", () => {
    expect(() => ensureDefaultCountJobType(w.db, w.ctx, auth, "nope")).toThrow();
  });
});

describe("plan lock", () => {
  it("only Inventory Updated is locked", () => {
    expect(planLockedReason("Inventory Updated")).toMatch(/Locked/);
    for (const s of ["Pending", "Ready To Count", "Count Started", "Count Completed", "Cancelled"]) expect(planLockedReason(s)).toBeNull();
  });
});
