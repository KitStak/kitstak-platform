/** M01 Picking/Job Operations modal options: picking job types with batch rules + mergeable pending jobs. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { orderJobOptions } from "@/server/repositories/orders-options";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
beforeEach(() => {
  w = createWorld();
});
afterEach(() => w.close());

describe("orderJobOptions", () => {
  it("lists only picking job types of the warehouse with their batch rules", () => {
    const opts = orderJobOptions(w.db, { warehouseIds: [w.warehouseId], clientIds: "all" }, w.warehouseId);
    expect(Array.isArray(opts.jobTypes)).toBe(true);
    for (const t of opts.jobTypes) {
      expect(t.batchMax).toBeGreaterThanOrEqual(0);
      expect(["Nof Order", "Nof Item"]).toContain(t.batchMethod);
    }
    expect(Array.isArray(opts.mergeableJobs)).toBe(true);
  });

  it("returns nothing for a warehouse outside the caller's scope", () => {
    expect(orderJobOptions(w.db, { warehouseIds: [], clientIds: "all" }, w.warehouseId)).toEqual({ jobTypes: [], mergeableJobs: [] });
  });
});
