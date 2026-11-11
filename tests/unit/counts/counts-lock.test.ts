/** M07 location lock derivation (REQ-1 entry point): open locking plans lock their locations until cancel / post. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { ledger } from "@/server/domain/ledger";
import { createCountJobs } from "@/server/repositories/counts-jobs";
import { countLockFor, countLockMessage } from "@/server/repositories/counts-lock";
import { cancelCountPlans } from "@/server/repositories/counts-ops";
import { createCountPlan } from "@/server/repositories/counts-plans";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
let cycleType: string;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  cycleType = (await w.db.insert(schema.jobTypes).values({
    code: "Cycle Count", description: "Cycle Count", warehouseId: w.warehouseId, operationType: "Count",
    settings: jobTypeSettingsSchema.parse({ count: { autoUpdateNoDifferenceLines: false } }),
  }).returning())[0].id;
});
afterEach(() => w.close());

const stock = async (qty: number, locationId: string) =>
  await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId, qty });

const plan = async (code: string, lock: boolean, countType: "SKU" | "Location", locationIds: string[] = []) => await createCountPlan(w.db, w.ctx, auth, {
  code, warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: lock,
  countType, locationIds, productIds: countType === "SKU" ? [w.productId] : [],
});

describe("countLockFor", () => {
  it("locks the stocked locations of a Pending SKU plan and keeps them locked after Create Job", async () => {
    await stock(20, w.loc.storageA);
    const p = await plan("KS-LOCK-SKU", true, "SKU");
    expect(await countLockFor(w.db, w.loc.storageA)).toBe("KS-LOCK-SKU");
    expect(await countLockFor(w.db, w.loc.storageB)).toBeNull();
    await createCountJobs(w.db, w.ctx, auth, { ids: [p.id], jobTypeId: cycleType, batchSize: 5, assigneeUserId: null });
    expect(await countLockFor(w.db, w.loc.storageA)).toBe("KS-LOCK-SKU");
  });

  it("does not lock when Lock Locations is No", async () => {
    await plan("KS-LOCK-NO", false, "Location", [w.loc.storageA]);
    expect(await countLockFor(w.db, w.loc.storageA)).toBeNull();
  });

  it("unlocks on cancel", async () => {
    const p = await plan("KS-LOCK-LOC", true, "Location", [w.loc.storageA]);
    expect(await countLockFor(w.db, w.loc.storageA)).toBe("KS-LOCK-LOC");
    await cancelCountPlans(w.db, w.ctx, auth, [p.id]);
    expect(await countLockFor(w.db, w.loc.storageA)).toBeNull();
  });

  it("names the plan in the message", () => {
    expect(countLockMessage("A-01", "CNT000001")).toContain("count plan CNT000001");
  });
});
