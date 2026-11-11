/**
 * Blind-judge repair round 1 (M13): date columns never ellipsize, capacity resolution,
 * timing share, labor backfill layout, scheduled report delivery, dashboard layout prefs,
 * scatter label placement and per-card freshness.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { EMPTY_GRID_QUERY, parseGridQuery, type GridQuery } from "@/server/query/grid-query";
import { DATE_MIN_WIDTH, DATE_TEXT_RE, DATETIME_MIN_WIDTH, reportColumnWidth } from "@/components/reports/report-cells";
import { CAPACITY_SOURCES, capacitySourceOf, UTILIZATION_DEF, UTILIZATION_DEFAULT_FILTER } from "@/lib/grid-defs/reports/analysis";
import { CHANGE_LOG_DEF, EXPORT_HISTORY_DEF } from "@/lib/grid-defs/reports/logs";
import { USER_PERFORMANCE_DEF } from "@/lib/grid-defs/reports/receiving";
import { listUtilization } from "@/server/repositories/reports-analysis";
import { taskTiming, timingShare } from "@/server/repositories/analytics-labor";
import { planStarts, taskSeconds, unitHash } from "@/server/repositories/analytics-labor-backfill";
import { cadenceLabel, createSchedule, deliverSchedule, listSchedules, nextRunAfter, runDueSchedules, SCHEDULABLE } from "@/server/repositories/reports-schedules";
import { cardSpans } from "@/components/dashboard/dashboard-view";
import { DEFAULT_LAYOUT, layoutFromPrefs, layoutToPrefs, moveCard } from "@/components/dashboard/dashboard-layout";
import { freshnessLabel } from "@/components/dashboard/widgets";
import { scatterLabelPlacement } from "@/components/analytics/scatter-scale";
import { sharePct } from "@/components/analytics/analytics-page";
import { SCHEDULABLE_KEYS } from "@/components/reports/report-grid-page";
import { buildAuthContext } from "@/server/auth/context";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
const q = (qs = ""): GridQuery => ({ ...EMPTY_GRID_QUERY, ...parseGridQuery(qs).query, pageSize: 500 });

beforeEach(async () => {
  w = await createWorld();
  const user = (await w.db.select().from(schema.users))[0]!;
  auth = await buildAuthContext(w.db, { id: user.id, email: user.email, name: user.name, role: user.role, userType: user.userType, allClients: true, isApiUser: false, sessionId: "t", sessionVersion: 0, sessionExpiresAt: "" } as never);
});
afterEach(() => w.close());

describe("date columns are never ellipsized", () => {
  it("clamps date and date-time columns to a minimum that fits the full value", () => {
    expect(reportColumnWidth({ kind: "datetime", width: 150 })).toEqual({ size: DATETIME_MIN_WIDTH, minSize: DATETIME_MIN_WIDTH });
    expect(reportColumnWidth({ kind: "date", width: 90 })).toEqual({ size: DATE_MIN_WIDTH, minSize: DATE_MIN_WIDTH });
    expect(reportColumnWidth({ kind: "text", width: 90 }).size).toBe(90);
    for (const def of [CHANGE_LOG_DEF, EXPORT_HISTORY_DEF]) {
      for (const c of def.columns.filter((x) => x.kind === "datetime")) expect(reportColumnWidth(c).size).toBeGreaterThanOrEqual(DATETIME_MIN_WIDTH);
    }
    expect(CHANGE_LOG_DEF.columns.find((c) => c.id === "module")?.width).toBeGreaterThanOrEqual(180);
  });
  it("recognises dates written as text so they wrap instead of truncating", () => {
    expect(DATE_TEXT_RE.test("11/10/2026 01:37 PM EST")).toBe(true);
    expect(DATE_TEXT_RE.test("2026-11-10 13:37")).toBe(true);
    expect(DATE_TEXT_RE.test("11/10/2026")).toBe(true);
    expect(DATE_TEXT_RE.test("SO010883 / NOVA-CBL")).toBe(false);
  });
});

describe("location utilization capacity", () => {
  it("resolves the most exact capacity source first", () => {
    expect(capacitySourceOf(50, 240)).toBe("Max Capacity Qty");
    expect(capacitySourceOf(0, 240, { productMaxQty: 72 })).toBe("Product Max Qty");
    expect(capacitySourceOf(0, 240, { volume: 9072 })).toBe("Cube (volume)");
    expect(capacitySourceOf(0, 240, { volume: 9072, allStockHasDims: false })).toBe("Legacy Capacity Units (estimate)");
    expect(capacitySourceOf(0, 0)).toBe("Not Set");
    expect(CAPACITY_SOURCES).toContain("Cube (volume)");
    expect(UTILIZATION_DEFAULT_FILTER).toBe("f.estimated=bool:false");
  });
  it("uses cube when the location has a volume, and keeps legacy units only as a hidden-by-default estimate", async () => {
    const loc = await w.db.select().from(schema.locations);
    const [a, b] = loc;
    await w.db.update(schema.locations).set({ volume: 1000, maxCapacityQty: 0, capacityUnits: 240 });
    if (b) await w.db.update(schema.locations).set({ volume: 0 }).where(eq(schema.locations.id, b.id));
    await w.db.update(schema.products).set({ lengthIn: 10, widthIn: 5, heightIn: 2 }); // 100 in³ per unit
    const inv = (await w.db.select().from(schema.inventory)).filter((i) => i.onHand > 0);
    const at = inv.find((i) => i.locationId === a?.id);
    const rows = (await listUtilization(w.db, auth, q())).rows;
    const rowA = rows.find((r) => r.rowId === a?.id);
    expect(rowA?.capacitySource).toBe("Cube (volume)");
    if (at) {
      const units = inv.filter((i) => i.locationId === a?.id).reduce((s, i) => s + i.onHand, 0);
      expect(rowA?.utilizationPct).toBeCloseTo(Math.round(units * 100 * 1000 / 1000) / 10, 1);
      expect(rowA?.capacity).toBe(10);
    }
    if (b) expect(rows.find((r) => r.rowId === b.id)?.capacitySource).toBe("Legacy Capacity Units (estimate)");
    const exact = (await listUtilization(w.db, auth, q(UTILIZATION_DEFAULT_FILTER))).rows;
    expect(exact.every((r) => r.estimated === 0)).toBe(true);
    expect(UTILIZATION_DEF.columns.some((c) => c.id === "usedCube")).toBe(true);
  });
});

describe("task timing share", () => {
  it("classifies timed, inferred and unevidenced tasks", () => {
    expect(taskTiming("2026-11-01T10:00:00Z", "2026-11-01T10:02:00Z", null)).toBe("timed");
    expect(taskTiming("2026-11-01T10:02:00Z", "2026-11-01T10:02:00Z", "2026-11-01T10:00:00Z")).toBe("inferred");
    expect(taskTiming(null, "2026-11-01T10:02:00Z", null)).toBe("none");
    expect(timingShare([{ timing: "timed" }, { timing: "timed" }, { timing: "inferred" }, { timing: "none" }])).toEqual({ total: 4, timed: 2, inferred: 1, none: 1 });
    expect(sharePct(97, 100)).toBe("97 %");
    expect(sharePct(1, 300)).toBe("<1 %");
    expect(sharePct(0, 10)).toBe("0 %");
  });
  it("User Performance shows tasks, timed share and timed minutes", () => {
    const ids = USER_PERFORMANCE_DEF.columns.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["taskQty", "timedTaskPct", "timedMinutes"]));
  });
});

describe("labor history backfill layout", () => {
  it("gives each task a start before its finish without overlapping the previous task", () => {
    const t = (id: string, iso: string, s: number) => ({ id, finishedMs: Date.parse(iso), seconds: s });
    const plan = planStarts([t("a", "2026-11-01T10:05:00Z", 120), t("b", "2026-11-01T10:06:00Z", 120)]);
    const a = plan.find((p) => p.id === "a")!;
    const b = plan.find((p) => p.id === "b")!;
    expect(a.finishMs - a.startMs).toBe(120_000);
    expect(b.startMs).toBeGreaterThanOrEqual(a.finishMs + 5_000 - 1);
    expect(b.finishMs).toBe(Date.parse("2026-11-01T10:06:00Z"));
  });
  it("lays a batch scan out back to back, ending at the batch instant", () => {
    const end = Date.parse("2026-11-01T12:00:00Z");
    const plan = planStarts([{ id: "x", finishedMs: end, seconds: 60 }, { id: "y", finishedMs: end + 8, seconds: 60 }, { id: "z", finishedMs: end + 16, seconds: 60 }]);
    expect(plan).toHaveLength(3);
    expect(plan[2]!.finishMs).toBe(end + 16);
    for (let i = 1; i < plan.length; i += 1) expect(plan[i]!.startMs).toBeGreaterThanOrEqual(plan[i - 1]!.finishMs - 1);
  });
  it("leaves tasks inferred when there is no room for a 15 s task", () => {
    const end = Date.parse("2026-11-01T12:00:00Z");
    expect(planStarts([{ id: "q", finishedMs: end, seconds: 90 }], end - 10_000)).toEqual([]);
  });
  it("durations are deterministic and scale with pace", () => {
    expect(taskSeconds("Picking", 1, "t1")).toBe(taskSeconds("Picking", 1, "t1"));
    expect(taskSeconds("Picking", 0.5, "t1")).toBeLessThan(taskSeconds("Picking", 1.5, "t1"));
    expect(unitHash("abc")).toBeGreaterThanOrEqual(0);
    expect(unitHash("abc")).toBeLessThanOrEqual(1);
  });
});

describe("scheduled report delivery", () => {
  it("computes the next daily / weekly run in the schedule's zone (DST-safe)", () => {
    const d = { frequency: "daily" as const, weekday: 1, time: "07:00", timeZone: "America/New_York" };
    expect(nextRunAfter(d, new Date("2026-11-10T11:00:00Z")).toISOString()).toBe("2026-11-10T12:00:00.000Z");
    expect(nextRunAfter(d, new Date("2026-11-10T12:00:00Z")).toISOString()).toBe("2026-11-11T12:00:00.000Z");
    expect(nextRunAfter(d, new Date("2026-03-07T13:00:00Z")).toISOString()).toBe("2026-03-08T11:00:00.000Z"); // after spring forward
    const wk = { ...d, frequency: "weekly" as const, weekday: 1 };
    expect(nextRunAfter(wk, new Date("2026-11-10T12:00:00Z")).toISOString()).toBe("2026-11-16T12:00:00.000Z");
    expect(cadenceLabel(wk)).toBe("Weekly on Monday at 07:00 (America/New_York)");
  });
  it("every report grid except Export History can be scheduled, and the UI list matches", () => {
    expect([...SCHEDULABLE.keys()].sort()).toEqual([...SCHEDULABLE_KEYS].sort());
    expect(SCHEDULABLE.has("report-export-history")).toBe(false);
  });
  it("creates, lists, delivers a CSV into Export History and moves the next run on", async () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const s = await createSchedule(w.db, auth, {
      gridKey: "report-location-utilization", name: "Daily space", query: "f.estimated=bool:false", frequency: "daily", time: "06:00",
      timeZone: "America/New_York", format: "csv", recipients: ["ops@example.com", "OPS@example.com"],
    }, now);
    expect(s.recipients).toEqual(["ops@example.com"]);
    expect((await listSchedules(w.db, auth)).map((x) => x.id)).toEqual([s.id]);
    const sent: string[] = [];
    const mail = async (_db: unknown, m: { to: string; subject: string; text: string }) => { sent.push(`${m.to}|${m.subject}|${m.text}`); return { transport: "log" as const, delivered: false }; };
    const r = await deliverSchedule(w.db, auth.user.id, { ...s }, { now, store: w.files, mail: mail as never, baseUrl: "https://wms.test" });
    expect(r.status).toBe("ok");
    const task = (await w.db.select().from(schema.backgroundTasks)).find((t) => t.id === r.taskId)!;
    expect(task).toMatchObject({ kind: "export", status: "completed", gridKey: "report-location-utilization", rowCount: r.rows });
    expect(sent[0]).toContain("https://wms.test/api/files/");
    expect(sent[0]).toContain("Location Utilization Report - Daily space");
    // Due run: the scheduler tick delivers it and schedules the next day.
    const due = await runDueSchedules(w.db, new Date("2026-11-11T11:30:00Z"));
    expect(due).toEqual({ delivered: 1, failed: 0 });
    const after = (await listSchedules(w.db, auth))[0]!;
    expect(after.lastStatus).toBe("ok");
    expect(after.nextRunAt).toBe("2026-11-12T11:00:00.000Z");
  });
  it("rejects unknown reports, bad times and empty recipients", async () => {
    await expect(async () => await createSchedule(w.db, auth, { gridKey: "report-export-history", name: "x", frequency: "daily", time: "07:00", timeZone: "UTC", recipients: ["a@b.co"] })).rejects.toThrow();
    await expect(async () => await createSchedule(w.db, auth, { gridKey: "report-change-log", name: "x", frequency: "daily", time: "7am", timeZone: "UTC", recipients: ["a@b.co"] })).rejects.toThrow();
    await expect(async () => await createSchedule(w.db, auth, { gridKey: "report-change-log", name: "x", frequency: "daily", time: "07:00", timeZone: "UTC", recipients: [] })).rejects.toThrow();
  });
});

describe("dashboard layout", () => {
  it("round-trips order, hidden cards and Open-on defaults through grid prefs", () => {
    const l = { ...DEFAULT_LAYOUT, order: moveCard(DEFAULT_LAYOUT.order, "jobs", -1), hidden: ["countries" as const], defaultWarehouseIds: ["wh1"], defaultClientIds: [] };
    const back = layoutFromPrefs(layoutToPrefs(l));
    expect(back.order.slice(-2)).toEqual(["jobs", "countries"]);
    expect(back.hidden).toEqual(["countries"]);
    expect(back.defaultWarehouseIds).toEqual(["wh1"]);
    expect(layoutFromPrefs(null)).toEqual(DEFAULT_LAYOUT);
    expect(layoutFromPrefs({ order: ["bogus", "jobs"], visible: [] }).order[0]).toBe("jobs");
  });
  it("a lone Progress or Unfulfilled card takes the full row", () => {
    expect(cardSpans(["progress", "unfulfilled"])).toMatchObject({ progress: "lg:col-span-4", unfulfilled: "lg:col-span-8" });
    expect(cardSpans(["progress", "breakdown"]).progress).toBe("lg:col-span-12");
    expect(cardSpans(["breakdown", "unfulfilled"]).unfulfilled).toBe("lg:col-span-12");
  });
  it("labels per-card freshness and flags stale data", () => {
    const asOf = "2026-11-10T18:00:00Z";
    expect(freshnessLabel({ asOf, intervalMs: 60_000, now: Date.parse(asOf) + 30_000 })?.stale).toBe(false);
    const stale = freshnessLabel({ asOf, intervalMs: 60_000, now: Date.parse(asOf) + 5 * 60_000 });
    expect(stale?.stale).toBe(true);
    expect(stale?.text).toMatch(/5 min ago/);
    expect(freshnessLabel({ asOf: null, intervalMs: 60_000, now: 1 })).toBeNull();
  });
});

describe("quadrant labels", () => {
  it("points near the right edge label to the left; close neighbours drop below", () => {
    const rows = [{ user: "A", v: 100, s: 40 }, { user: "B", v: 102, s: 40.5 }, { user: "C", v: 320, s: 35 }];
    const out = scatterLabelPlacement(rows, "v", "s");
    expect(out[2]!.__labelLeft).toBe(true);
    expect(Boolean(out[0]!.__labelBelow) !== Boolean(out[1]!.__labelBelow)).toBe(true);
  });
});
