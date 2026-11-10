/** M07 LP count type: one line per license plate, scoped to that LP's buckets only. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { ledger } from "@/server/domain/ledger";
import { countPlanInputSchema, createCountPlan } from "@/server/repositories/counts-plans";
import { expectedBuckets } from "@/server/domain/task-handlers/count";
import { listPickLps } from "@/server/repositories/counts-pickers";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
let lpId: string;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  const typeId = w.db.insert(schema.lpTypes).values({ warehouseId: w.warehouseId, code: "PLT", numberPrefix: "LP", numberLength: 6 }).returning().get().id;
  lpId = w.db.insert(schema.licensePlates).values({ number: "LP000123", warehouseId: w.warehouseId, lpTypeId: typeId, locationId: w.loc.storageA }).returning().get().id;
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, lpId, qty: 7 });
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 30 });
});
afterEach(() => w.close());

const input = (lpIds: string[]) => ({
  code: "KS-LP-1", warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: false,
  countType: "LP" as const, locationIds: [], productIds: [], lpIds,
});

describe("LP count plans", () => {
  it("requires at least one license plate", () => {
    const r = countPlanInputSchema.safeParse(input([]));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["lpIds"]);
  });

  it("creates one line per LP at its location with only the LP's stock in scope", () => {
    const plan = createCountPlan(w.db, w.ctx, auth, input([lpId]));
    expect(plan.countType).toBe("LP");
    const lines = w.db.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, plan.id)).all();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ locationId: w.loc.storageA, lpId, productId: null, initialStockQty: 7 });
    // The count task (sheet / mobile) only expects the LP bucket, not the 30 loose units beside it.
    expect(expectedBuckets(w.db, lines[0]!, w.loc.storageA).map((b) => b.onHand)).toEqual([7]);
  });

  it("rejects LPs that are not placed in a location", () => {
    w.db.update(schema.licensePlates).set({ locationId: null }).where(eq(schema.licensePlates.id, lpId)).run();
    expect(() => createCountPlan(w.db, w.ctx, auth, input([lpId]))).toThrow(/not in a location/);
  });

  it("lists placed LPs with their on-hand in the picker", () => {
    const page = listPickLps(w.db, auth.scope, w.warehouseId, EMPTY_GRID_QUERY);
    expect(page.rows).toEqual([expect.objectContaining({ number: "LP000123", onHand: 7, skuCount: 1 })]);
  });
});
