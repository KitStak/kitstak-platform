/**
 * Round 4: server-side run lock (no duplicate waves from a double POST) and one open
 * job-type elimination exception per order per rule; wave log eliminated count.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import { waveRuleInputSchema } from "@/lib/grid-defs/jobs/forms";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { createOrder } from "@/server/domain/orders";
import { ledger } from "@/server/domain/ledger";
import { createWaveRule } from "@/server/repositories/wave-rules";
import { assertRuleRunnable, RUN_LOCK_SECONDS, runWave } from "@/server/repositories/waves-run";
import { listWaves } from "@/server/repositories/waves";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
let singleType: string;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId, name: "Admin" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  singleType = (await w.db.insert(schema.jobTypes).values({
    code: "Single Unit Orders", description: "Single", warehouseId: w.warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({ orderScope: "Single Item Orders" }),
  }).returning())[0].id;
});
afterEach(() => w.close());

const rule = async () => await createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({ name: "Singles", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [singleType] }));

describe("wave run lock", () => {
  it("refuses a second run of the same rule within the lock window, then allows it", async () => {
    const r = await rule();
    const t0 = new Date("2026-11-09T10:00:00.000Z");
    await assertRuleRunnable(w.db, r.id, t0);
    await runWave(w.db, w.ctx, r.id, { runBy: "Admin", now: t0 });
    await expect(async () => await assertRuleRunnable(w.db, r.id, new Date(t0.getTime() + 2_000))).rejects.toThrow(/ran 2s ago/);
    await assertRuleRunnable(w.db, r.id, new Date(t0.getTime() + RUN_LOCK_SECONDS * 1000));
  });

  it("refuses while the latest wave is still Started", async () => {
    const r = await rule();
    await w.db.insert(schema.waves).values({ waveNo: "X-1", waveRuleId: r.id, warehouseId: w.warehouseId, status: "Started", runBy: "Admin", runAt: "2020-01-01T00:00:00.000Z" });
    await expect(async () => await assertRuleRunnable(w.db, r.id)).rejects.toThrow(/still running/);
  });
});

describe("elimination exceptions", () => {
  it("keeps one open row per order per rule and moves it to the latest wave; the log reports eliminated", async () => {
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 10 });
    const multi = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 3 }]));
    const r = await rule();
    await runWave(w.db, w.ctx, r.id, { runBy: "Admin", now: new Date("2026-11-09T10:00:00.000Z") });
    const second = await runWave(w.db, w.ctx, r.id, { runBy: "Admin", now: new Date("2026-11-09T11:00:00.000Z") });
    const rows = await w.db.select().from(schema.allocationExceptions).where(eq(schema.allocationExceptions.orderId, multi.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.waveNo).toBe(second.wave.waveNo);

    const log = await listWaves(w.db, auth, { ...EMPTY_GRID_QUERY, pageSize: 10 });
    for (const row of log.rows as Record<string, number>[]) {
      expect(row.ordersMet).toBe(row.allocatedOrders + row.shortageOrders + row.eliminatedOrders);
      expect(row.eliminatedOrders).toBe(1);
    }
  });
});
