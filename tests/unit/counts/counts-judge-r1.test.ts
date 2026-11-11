/**
 * Blind-judge repair round 1 (M07): Inventory Update User backfill, cancelled lines in the plan
 * totals and the job preview, superseded approved quantities, picker filter breadth, the handheld
 * "assigned to other counters" list, description edits on Inventory Updated plans, the ledger
 * count lock (REQ-1) and the login rate limit refund.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import { approvedQtySuperseded, planNameLockedReason } from "@/lib/grid-defs/counts/count-math";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { authenticate } from "@/server/auth/login";
import { hashPassword } from "@/server/auth/password";
import { ledger } from "@/server/domain/ledger";
import { parseGridQuery } from "@/server/query/grid-query";
import { findInventoryUpdateUserGaps, repairInventoryUpdateUser, countIntegrityIssues } from "@/server/repositories/counts-integrity";
import { createCountJobs, previewCountJobs } from "@/server/repositories/counts-jobs";
import { cancelCountLines } from "@/server/repositories/counts-ops";
import { listPickLocations, listPickProducts } from "@/server/repositories/counts-pickers";
import { createCountPlan, listCountPlans } from "@/server/repositories/counts-plans";
import { listScanJobs } from "@/server/repositories/counts-scan-jobs";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
let cycleType: string;
beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId, role: "admin" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  cycleType = (await w.db.insert(schema.jobTypes).values({ code: "Cycle Count", description: "Cycle", warehouseId: w.warehouseId, operationType: "Count", settings: jobTypeSettingsSchema.parse({ count: {} }) }).returning())[0].id;
});
afterEach(() => w.close());

const mk = async (code: string, locationIds: string[], lockLocations = false) => await createCountPlan(w.db, w.ctx, auth, { code, warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations, countType: "Location", locationIds, productIds: [] });
const q = (params: Record<string, string>) => parseGridQuery(new URLSearchParams(params)).query;

describe("Inventory Update User", () => {
  it("backfills an email (old seed) to the user id and leaves nothing for db:verify", async () => {
    const p = await mk("JR1-U", [w.loc.storageA]);
    const email = (await w.db.select().from(schema.users).where(eq(schema.users.id, w.userId)).limit(1))[0]?.email ?? "";
    await w.db.update(schema.countPlans).set({ status: "Inventory Updated", inventoryUpdatedBy: email }).where(eq(schema.countPlans.id, p.id));
    await w.db.update(schema.countPlanLines).set({ status: "Inventory Updated", inventoryUpdatedBy: null }).where(eq(schema.countPlanLines.planId, p.id));
    expect((await findInventoryUpdateUserGaps(w.db)).map((g) => g.table).sort()).toEqual(["count_plan_lines", "count_plans"]);
    expect((await countIntegrityIssues(w.db)).some((i) => i.check === "count_inventory_update_user")).toBe(true);
    expect(await repairInventoryUpdateUser(w.db as never)).toEqual({ plans: 1, lines: 1 });
    expect((await w.db.select().from(schema.countPlans).where(eq(schema.countPlans.id, p.id)).limit(1))[0]?.inventoryUpdatedBy).toBe(w.userId);
    expect(await findInventoryUpdateUserGaps(w.db)).toEqual([]);
    const row = (await listCountPlans(w.db, auth.scope, q({ q: "JR1-U" }))).rows[0];
    expect(row?.inventoryUpdatedByName).toBeTruthy();
  });
});

describe("cancelled lines", () => {
  it("are left out of Number of Location and the job preview, and reported as cancelledLineCount / cancelled", async () => {
    const p = await mk("JR1-C", [w.loc.storageA, w.loc.storageB]);
    const lines = await w.db.select().from(schema.countPlanLines).where(eq(schema.countPlanLines.planId, p.id));
    await cancelCountLines(w.db, w.ctx, auth, [lines[1]?.id ?? ""]);
    const row = (await listCountPlans(w.db, auth.scope, q({ q: "JR1-C" }))).rows[0];
    expect(row?.locationCount).toBe(1);
    expect(row?.cancelledLineCount).toBe(1);
    expect((await previewCountJobs(w.db, auth, [p.id]))[0]).toMatchObject({ units: 1, cancelled: 1 });
  });
});

describe("approved quantities on lines that never posted", () => {
  it("Recount Created and Cancelled read as superseded / not posted; posted and open lines keep their values", () => {
    expect(approvedQtySuperseded("Recount Created")?.tag).toBe("Superseded");
    expect(approvedQtySuperseded("Cancelled")?.tag).toBe("Not posted");
    for (const s of ["Inventory Updated", "Count Completed", "Ready To Count", "Pending"]) expect(approvedQtySuperseded(s)).toBeNull();
  });
});

describe("Inventory Updated plans", () => {
  it("lock the name only", () => {
    expect(planNameLockedReason("Inventory Updated")).toMatch(/description/);
    expect(planNameLockedReason("Cancelled")).toBeNull();
  });
});

describe("picker filters", () => {
  it("filter locations by in-open-count and has inventory, products by has inventory and kit", async () => {
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 4 });
    await mk("JR1-P", [w.loc.storageA]);
    const inOpen = (await listPickLocations(w.db, auth.scope, w.warehouseId, q({ "f.inOpenCount": "bool:true" }), true)).rows.map((r) => r.id);
    expect(inOpen).toEqual([w.loc.storageA]);
    const notOpen = (await listPickLocations(w.db, auth.scope, w.warehouseId, q({ "f.inOpenCount": "bool:false" }), true)).rows.map((r) => r.id);
    expect(notOpen).not.toContain(w.loc.storageA);
    const stocked = (await listPickProducts(w.db, auth.scope, w.warehouseId, q({ "f.hasInventory": "bool:true" }))).rows.map((r) => r.id);
    expect(stocked).toEqual([w.productId]);
    const kits = (await listPickProducts(w.db, auth.scope, w.warehouseId, q({ "f.isKit": "bool:true" }))).rows;
    expect(kits.every((r) => (r as unknown as { isKit: boolean }).isKit === true)).toBe(true);
    const never = (await listPickLocations(w.db, auth.scope, w.warehouseId, q({}), true)).rows.find((r) => r.id === w.loc.storageA) as unknown as { lastCountedAt: string | null; inOpenCount: boolean };
    expect(never.lastCountedAt).toBeNull();
    expect(never.inOpenCount).toBe(true);
  });
});

describe("handheld: jobs assigned to other counters", () => {
  it("lists them under view=others so an empty pool can explain why", async () => {
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 3 });
    const other = (await w.db.insert(schema.users).values({ email: "jr1-other@example.com", name: "Jonah Counter", passwordHash: "x", role: "operator" }).returning())[0];
    const p = await mk("JR1-POOL", [w.loc.storageA]);
    expect((await createCountJobs(w.db, w.ctx, auth, { ids: [p.id], jobTypeId: cycleType, batchSize: 10, assigneeUserId: other.id })).failed).toEqual([]);
    expect((await listScanJobs(w.db, auth, "pool")).some((j) => j.planCode === "JR1-POOL")).toBe(false);
    const others = await listScanJobs(w.db, auth, "others");
    expect(others.find((j) => j.planCode === "JR1-POOL")?.assigneeName).toBe("Jonah Counter");
  });
});

describe("ledger count lock (REQ-1)", () => {
  it("blocks a move out of a Lock Locations plan's location and names the plan", async () => {
    const bucket = await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 5 });
    await mk("JR1-LOCK", [w.loc.storageA], true);
    await expect(async () => await ledger.move(w.db, w.ctx, { inventoryId: bucket.bucket.id, qty: 1, toLocationId: w.loc.storageB })).rejects.toThrow(/locked by count plan JR1-LOCK/);
  });
});

describe("login rate limit", () => {
  it("successful sign-ins do not use up the shared per-IP budget; failures still do", async () => {
    const now = new Date("2026-11-10T08:00:00.000Z");
    const email = "jr1-scanner@example.com";
    await w.db.insert(schema.users).values({ email, name: "Scanner", passwordHash: hashPassword("Scan!ner2026", 4), role: "operator" });
    for (let i = 0; i < 12; i += 1) expect(await authenticate(w.db, { email, password: "Scan!ner2026", ip: "direct", userAgent: null }, now)).toMatchObject({ ok: true });
    for (let i = 0; i < 5; i += 1) await authenticate(w.db, { email: `nobody${i}@x.io`, password: "x", ip: "direct", userAgent: null }, now);
    expect(await authenticate(w.db, { email, password: "Scan!ner2026", ip: "direct", userAgent: null }, now)).toMatchObject({ ok: false, reason: "rate_limited" });
  });
});
