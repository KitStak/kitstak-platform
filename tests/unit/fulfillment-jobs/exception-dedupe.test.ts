/**
 * Round 5: allocation exceptions show one explanation per order per wave. The order-level
 * "Order bypassed" row is hidden when the same wave already lists line-level SKU shortages.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { createOrder } from "@/server/domain/orders";
import { listAllocationExceptions } from "@/server/repositories/waves";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId, name: "Admin" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const exc = (orderId: string, waveId: string | null, explanation: string, productId: string | null) =>
  w.db.insert(schema.allocationExceptions).values({
    id: crypto.randomUUID(), orderId, waveId, waveNo: "Manual Allocation", explanation, shortageProductId: productId,
    warehouseId: w.warehouseId, clientId: w.clientId, runBy: "Admin", runAt: new Date().toISOString(),
  } as typeof schema.allocationExceptions.$inferInsert).run();

describe("allocation exception de-duplication", () => {
  it("hides the order-level bypass row when the wave has line-level shortages for the order", () => {
    const a = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const b = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    exc(a.id, null, "Shortage", w.productId);
    exc(a.id, null, "Order bypassed: All items are currently out of stock", null);
    exc(b.id, null, "Order bypassed: All items are currently out of stock", null);
    const { rows: raw, total } = listAllocationExceptions(w.db, auth, EMPTY_GRID_QUERY);
    const rows = raw as unknown as { orderId: string; explanation: string }[];
    expect(total).toBe(2);
    const forA = rows.filter((r) => r.orderId === a.id).map((r) => r.explanation);
    expect(forA).toEqual(["Shortage"]);
    expect(rows.filter((r) => r.orderId === b.id)).toHaveLength(1);
  });
});
