/** REQ-16: cancelling a recount (line cancel or job cancel) restores the original line to Count Completed. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { ledger } from "@/server/domain/ledger";
import { createCountJobs, createRecounts } from "@/server/repositories/counts-jobs";
import { cancelCountLines, updateInventoryForLines } from "@/server/repositories/counts-ops";
import { createCountPlan } from "@/server/repositories/counts-plans";
import { countSheet, submitSheetLine } from "@/server/repositories/counts-sheet";
import { releaseCountLines } from "@/server/repositories/jobs-commands";
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

describe("REQ-16 recount cancel restores the original line", () => {
  it("line cancel of the recount reopens the original as Count Completed and it can be posted", () => {
    const { p, line, recount } = setup();
    expect(cancelCountLines(w.db, w.ctx, auth, [recount.id]).failed).toEqual([]);
    const after = linesOf(p.id);
    expect(after.find((l) => l.id === recount.id)?.status).toBe("Cancelled");
    expect(after.find((l) => l.id === line.id)?.status).toBe("Count Completed");
    expect(updateInventoryForLines(w.db, w.ctx, auth, [line.id], rid).failed).toEqual([]);
    expect(linesOf(p.id).find((l) => l.id === line.id)?.status).toBe("Inventory Updated");
  });

  it("releasing the recount job's lines reopens the original", () => {
    const { p, line, recount, jobId } = setup();
    w.db.update(schema.tasks).set({ status: "Cancelled" }).where(eq(schema.tasks.countLineId, recount.id)).run();
    expect(releaseCountLines(w.db, w.ctx, jobId)).toBe(1);
    expect(linesOf(p.id).find((l) => l.id === line.id)?.status).toBe("Count Completed");
  });
});
