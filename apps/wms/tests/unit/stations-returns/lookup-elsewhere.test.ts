/** Return Station: a code that belongs to another warehouse in scope is reported with that warehouse ("Switch to …"). */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { Scope } from "@/server/auth/scope";
import { allocateOrders } from "@/server/domain/allocation";
import { createJobsFromOrders } from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { shipOrders } from "@/server/domain/shipping";
import { execute } from "@/server/domain/tasks";
import { insertRma, type ScopedCtx } from "@/server/repositories/returns";
import { rmaWarehousesFor } from "@/server/repositories/returns-receive";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
beforeEach(async () => { w = await createWorld(); });
afterEach(() => w.close());

describe("rmaWarehousesFor", () => {
  it("lists the warehouses in scope where the RMA matches, and nothing outside scope", async () => {
    const scope = { warehouseIds: [w.warehouseId], clientIds: "all" } as unknown as Scope;
    const ctx = { ...w.ctx, scope } as ScopedCtx;
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 5 });
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    const { jobIds: [jobId] } = await createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
    for (const [type, loc] of [["Picking", w.loc.pick], ["Packing", w.loc.pack]] as const) {
      const ids = (await w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, jobId ?? ""), eq(schema.tasks.taskType, type)))).map((t) => t.id);
      if (ids.length) await execute(w.db, w.ctx, { taskIds: ids, targetLocationId: loc });
    }
    await shipOrders(w.db, w.ctx, { orderIds: [o.id], requireLabel: false });
    const lineId = (await w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).limit(1))[0]?.id ?? "";
    const rma = await insertRma(w.db, ctx, { shipmentOrderId: o.id, lines: [{ orderLineId: lineId, quantity: 1 }] });
    const hits = await rmaWarehousesFor(w.db, scope, rma.rmaCode.toLowerCase());
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ warehouseId: w.warehouseId, rmaCodes: [rma.rmaCode] });
    expect(hits[0]?.warehouseCode).toBeTruthy();
    expect(await rmaWarehousesFor(w.db, { warehouseIds: [], clientIds: "all" } as unknown as Scope, rma.rmaCode)).toEqual([]);
  });
});
