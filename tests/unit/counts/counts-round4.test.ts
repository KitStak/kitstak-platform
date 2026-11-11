/** Round 4: Cancelled lines on SKU Details, plan-status drift repair, Mark damaged posting, Skip location order. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { ledger } from "@/server/domain/ledger";
import { findCountPlanStatusDrift, repairCountPlanStatusDrift } from "@/server/repositories/counts-integrity";
import { listCountLines } from "@/server/repositories/counts-lines";
import { createCountJobs } from "@/server/repositories/counts-jobs";
import { updateInventoryForLines } from "@/server/repositories/counts-ops";
import { countSheet, submitSheetLine } from "@/server/repositories/counts-sheet";
import { damagedDraftFor, draftsError, draftsFromBuckets, toPayload } from "@/components/counts/count-entry-table";
import { orderBySkip } from "@/components/counts/count-sheet";
import { createCountPlan } from "@/server/repositories/counts-plans";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(["inventory.count_plans.delete"]), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const q = { qm: "contains" as const, filters: [], sort: [], page: 1, pageSize: 100 };

async function locationPlan(code: string) {
  await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 12 });
  return await createCountPlan(w.db, w.ctx, auth, {
    code, warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: false,
    countType: "Location", locationIds: [w.loc.storageA], productIds: [],
  });
}
const setLines = async (planId: string, status: string) =>
  await w.db.update(schema.countPlanLines).set({ status: status as never }).where(eq(schema.countPlanLines.planId, planId));

describe("SKU Details lists Cancelled location lines", () => {
  it("a cancelled, never-counted location line expands to its on-hand SKUs", async () => {
    const p = await locationPlan("KS-R4-CXL");
    const before = (await listCountLines(w.db as never, auth.scope, "skus", q as never)).rows.filter((r) => r.planId === p.id);
    expect(before.length).toBe(1);
    await setLines(p.id, "Cancelled");
    const rows = (await listCountLines(w.db as never, auth.scope, "skus", q as never)).rows.filter((r) => r.planId === p.id);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("Cancelled");
    expect(rows[0]?.productId).toBe(w.productId);
  });
});

describe("plan status drift repair", () => {
  it("re-derives a plan that reads Inventory Updated with nothing posted", async () => {
    const p = await locationPlan("KS-R4-DRIFT");
    await setLines(p.id, "Cancelled");
    await w.db.update(schema.countPlans).set({ status: "Inventory Updated" }).where(eq(schema.countPlans.id, p.id));
    const drift = await findCountPlanStatusDrift(w.db as never);
    expect(drift.map((d) => [d.code, d.expected])).toEqual([["KS-R4-DRIFT", "Cancelled"]]);
    const fixed = await repairCountPlanStatusDrift(w.db as never, w.ctx);
    expect(fixed.length).toBe(1);
    const after = (await w.db.select().from(schema.countPlans).where(eq(schema.countPlans.id, p.id)).limit(1))[0];
    expect(after?.status).toBe("Cancelled");
    expect(await findCountPlanStatusDrift(w.db as never)).toEqual([]);
    const log = await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, p.id));
    expect(log.some((l) => l.field === "status" && l.toValue === "Cancelled")).toBe(true);
  });

  it("leaves a genuine Inventory Updated plan alone", async () => {
    const p = await locationPlan("KS-R4-OK");
    await setLines(p.id, "Inventory Updated");
    await w.db.update(schema.countPlans).set({ status: "Inventory Updated" }).where(eq(schema.countPlans.id, p.id));
    expect(await findCountPlanStatusDrift(w.db as never)).toEqual([]);
  });
});

describe("Mark damaged (handheld count action)", () => {
  it("posts damaged units to a damaged bucket and the rest to the sellable bucket", async () => {
    const p = await locationPlan("KS-R4-DMG");
    const rid = (await w.db.insert(schema.lookupValues).values({ type: "adjustment_reason", name: "Count variance" }).returning())[0].id;
    const jt = (await w.db.insert(schema.jobTypes).values({
      code: "Cycle Count", description: "Cycle Count", warehouseId: w.warehouseId, operationType: "Count", settings: jobTypeSettingsSchema.parse({ count: {} }),
    }).returning())[0].id;
    await createCountJobs(w.db, w.ctx, auth, { ids: [p.id], jobTypeId: jt, batchSize: 1, assigneeUserId: null });
    const sheetLine = (await countSheet(w.db, auth.scope, p.id))[0];
    if (!sheetLine) throw new Error("sheet line");
    const [good] = draftsFromBuckets(sheetLine.buckets);
    if (!good) throw new Error("bucket");
    const drafts = [{ ...good, counted: 10 }, { ...damagedDraftFor(good, "Crushed"), counted: 2 }];
    expect(draftsError(drafts)).toBeNull();
    await submitSheetLine(w.db, w.ctx, auth, p.id, { lineId: sheetLine.lineId, entries: toPayload(drafts), note: null });
    expect((await updateInventoryForLines(w.db, w.ctx, auth, [sheetLine.lineId], rid)).failed).toEqual([]);
    const stock = (await w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, w.loc.storageA))).filter((i) => i.onHand > 0);
    expect(stock.find((i) => !i.damageReason)?.onHand).toBe(10);
    expect(stock.find((i) => i.damageReason === "Crushed")?.onHand).toBe(2);
  });

  it("flags the same damaged bucket entered twice", () => {
    const base = { key: "a", inventoryId: "a", productId: "p", sku: "SKU", productName: "", lotNumber: null, lpNumber: null, systemQty: 3, counted: 1 };
    const d1 = { ...damagedDraftFor(base, "Crushed"), counted: 1 };
    const d2 = { ...d1, key: "b", inventoryId: "b", damagedFrom: undefined, systemQty: 1 };
    expect(draftsError([base, d1, d2])).toMatch(/listed twice/);
  });
});

describe("Skip location ordering", () => {
  it("moves skipped lines to the end in the order they were skipped", () => {
    const lines = ["a", "b", "c", "d"].map((lineId) => ({ lineId }));
    expect(orderBySkip(lines, ["b", "a"]).map((l) => l.lineId)).toEqual(["c", "d", "b", "a"]);
    expect(orderBySkip(lines, []).map((l) => l.lineId)).toEqual(["a", "b", "c", "d"]);
  });
});
