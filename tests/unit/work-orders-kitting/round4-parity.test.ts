/**
 * M08 round 4 (parity loop): idempotent Create Kit, legacy partial-status repair, idempotency key shape.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { newIdempotencyKey } from "@/lib/grid-defs/work-orders/kit-steps";
import { createKitSchema } from "@/lib/grid-defs/work-orders/work-order-model";
import { createWorkOrder } from "@/server/repositories/work-orders";
import { createKit, repairLegacyPartialStatuses } from "@/server/repositories/work-orders-commands";
import { createKitWorld, onHandAt, stock, woInput, type KitWorld } from "./kit-world";

let w: KitWorld;
beforeEach(() => {
  w = createKitWorld();
  stock(w, w.productId, 30);
  stock(w, w.product2Id, 12);
});
afterEach(() => w.close());

const woOf = (id: string) => w.db.select().from(schema.workOrders).where(eq(schema.workOrders.id, id)).get();

describe("Create Kit idempotency", () => {
  it("replays a retried call with the same key instead of consuming components twice", () => {
    const wo = createWorkOrder(w.db, w.wctx, woInput(w));
    const input = { workOrderId: wo.id, version: wo.version, qty: 1, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null, idempotencyKey: "ck-test-key-1" };
    const first = createKit(w.db, w.wctx, input);
    expect(first.replayed).toBeUndefined();
    // Same payload again (stale version too): replayed, not a CONFLICT and not a second build.
    const again = createKit(w.db, w.wctx, input);
    expect(again.replayed).toBe(true);
    expect(again.receiptId).toBe(first.receiptId);
    expect(woOf(wo.id)?.processedQty).toBe(1);
    expect(onHandAt(w, w.productId)).toBe(28);
    expect(onHandAt(w, w.kitId, w.kittingLocId)).toBe(1);
    // A new key is a new build.
    const fresh = woOf(wo.id);
    const second = createKit(w.db, w.wctx, { ...input, version: fresh?.version, idempotencyKey: "ck-test-key-2" });
    expect(second.processedQty).toBe(2);
    expect(onHandAt(w, w.kitId, w.kittingLocId)).toBe(2);
  });

  it("generates schema-valid keys", () => {
    const key = newIdempotencyKey();
    expect(createKitSchema.safeParse({ workOrderId: "x", qty: 1, locationId: "l", idempotencyKey: key }).success).toBe(true);
    expect(createKitSchema.safeParse({ workOrderId: "x", qty: 1, locationId: "l", idempotencyKey: "bad key!" }).success).toBe(false);
    expect(newIdempotencyKey()).not.toBe(key);
  });
});

describe("legacy partial status repair", () => {
  it("moves a without-picking partial In Process WO back to Open and logs it", () => {
    const wo = createWorkOrder(w.db, w.wctx, woInput(w));
    createKit(w.db, w.wctx, { workOrderId: wo.id, qty: 1, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null });
    w.db.update(schema.workOrders).set({ status: "In Process" }).where(eq(schema.workOrders.id, wo.id)).run();
    expect(repairLegacyPartialStatuses(w.db, w.wctx)).toEqual([wo.code]);
    expect(woOf(wo.id)?.status).toBe("Open");
    const log = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, wo.id)).all();
    expect(log.some((l) => l.field === "status" && l.toValue === "Open")).toBe(true);
    expect(repairLegacyPartialStatuses(w.db, w.wctx)).toEqual([]);
  });
});
