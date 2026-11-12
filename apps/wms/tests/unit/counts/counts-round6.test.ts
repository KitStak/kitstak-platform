/** Round 6: header-only Edit Count (name + description at any status, Logiwa parity). */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { cancelCountPlans } from "@/server/repositories/counts-ops";
import { countPlanHeaderSchema, createCountPlan, updateCountPlan, updateCountPlanHeader } from "@/server/repositories/counts-plans";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const mk = async (code: string, locationId = w.loc.storageA) => await createCountPlan(w.db, w.ctx, auth, { code, warehouseId: w.warehouseId, description: "x", scheduledAt: new Date().toISOString(), lockLocations: false, countType: "Location", locationIds: [locationId], productIds: [] });
const row = async (id: string) => (await w.db.select().from(schema.countPlans).where(eq(schema.countPlans.id, id)).limit(1))[0];

describe("updateCountPlanHeader", () => {
  it("renames and re-describes a cancelled plan, leaving lines and status alone, with a change-log entry", async () => {
    const p = await mk("H-1");
    await cancelCountPlans(w.db, w.ctx, auth, [p.id]);
    const before = await row(p.id);
    const u = await updateCountPlanHeader(w.db, w.ctx, auth, p.id, { version: before?.version ?? 0, code: "H-1-renamed", description: "why" });
    expect(u.code).toBe("H-1-renamed");
    expect((await row(p.id))?.status).toBe("Cancelled");
    expect((await row(p.id))?.description).toBe("why");
    const logs = await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, p.id));
    expect(logs.some((l) => l.field === "description")).toBe(true);
  });

  it("locks an Inventory Updated plan's name (ledger notes reference it) but keeps the description editable (Logiwa parity)", async () => {
    const p = await mk("H-L");
    await w.db.update(schema.countPlans).set({ status: "Inventory Updated" }).where(eq(schema.countPlans.id, p.id));
    const v = (await row(p.id))?.version ?? 0;
    await expect(async () => await updateCountPlanHeader(w.db, w.ctx, auth, p.id, { version: v, code: "H-L2", description: "x" })).rejects.toThrow(/Locked/);
    expect((await row(p.id))?.code).toBe("H-L");
    await updateCountPlanHeader(w.db, w.ctx, auth, p.id, { version: v, code: "H-L", description: "Annual audit, zone A" });
    expect((await row(p.id))?.description).toBe("Annual audit, zone A");
    expect((await row(p.id))?.status).toBe("Inventory Updated");
  });

  it("the full edit still refuses a non-pending plan", async () => {
    const p = await mk("H-2");
    await cancelCountPlans(w.db, w.ctx, auth, [p.id]);
    const v = (await row(p.id))?.version ?? 0;
    await expect(async () => await updateCountPlan(w.db, w.ctx, auth, p.id, { version: v, code: "H-2", warehouseId: w.warehouseId, description: null, scheduledAt: new Date().toISOString(), lockLocations: false, countType: "Location", locationIds: [w.loc.storageA], productIds: [] })).rejects.toThrow(/pending/i);
  });

  it("rejects stale versions and duplicate names; a no-op keeps the version", async () => {
    const a = await mk("H-3");
    await mk("H-4", w.loc.storageB);
    await expect(async () => await updateCountPlanHeader(w.db, w.ctx, auth, a.id, { version: a.version + 5, code: "H-3", description: null })).rejects.toThrow(/changed/);
    await expect(async () => await updateCountPlanHeader(w.db, w.ctx, auth, a.id, { version: a.version, code: "h-4", description: "x" })).rejects.toThrow(/already/);
    await updateCountPlanHeader(w.db, w.ctx, auth, a.id, { version: a.version, code: "H-3", description: "x" });
    expect((await row(a.id))?.version).toBe(a.version);
  });

  it("validates the name", () => {
    expect(countPlanHeaderSchema.safeParse({ version: 1, code: "  ", description: null }).success).toBe(false);
    expect(countPlanHeaderSchema.safeParse({ version: 1, code: "x".repeat(51), description: null }).success).toBe(false);
  });
});
