/**
 * Labor Analytics (KitStaks-designed, BUILD_PLAN Part D): 5 native dashboards built from
 * completed tasks and receipts. Task time = finish − start when the scanner recorded a
 * start; otherwise the gap since the associate's previous task that day (capped at 30
 * min, floored at 15 s), the usual "time between scans" labor method.
 */
import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AnalyticsChart, AnalyticsKpi, AnalyticsRow, LaborPage } from "./analytics-types";
import { dayFilter, fmtInt, median, PALETTE, rangeFilter, round, whIn, type Range } from "./analytics-common";

export const MAX_GAP_MINUTES = 30;
export const RECEIVING_GRID = "/receiving/history";
export const MIN_TASK_MINUTES = 0.25;

export interface TaskFact {
  readonly id: string;
  readonly type: string;
  readonly userId: string;
  readonly user: string;
  readonly day: string;
  readonly qty: number;
  readonly mins: number;
}

/** Task minutes from explicit start/finish, else the gap since the previous finish. */
export function taskMinutes(startedAt: string | null, finishedAt: string, prevFinishedAt: string | null): number | null {
  const fin = Date.parse(finishedAt);
  const start = startedAt ? Date.parse(startedAt) : NaN;
  if (Number.isFinite(start) && fin > start) return Math.max((fin - start) / 60_000, MIN_TASK_MINUTES);
  if (prevFinishedAt) {
    const gap = (fin - Date.parse(prevFinishedAt)) / 60_000;
    return Math.min(Math.max(gap, MIN_TASK_MINUTES), MAX_GAP_MINUTES);
  }
  return null;
}

export function loadTaskFacts(db: AppDb, r: Range, wh: readonly string[]): TaskFact[] {
  const rows = db.all<{ id: string; type: string; uid: string; user: string; started: string | null; fin: string; prev: string | null; qty: number }>(sql`
    SELECT t.id, t.task_type AS type, t.executed_by_user_id AS uid, u.name AS user, t.started_at AS started, t.finished_at AS fin,
           LAG(t.finished_at) OVER (PARTITION BY t.executed_by_user_id, substr(t.finished_at, 1, 10) ORDER BY t.finished_at) AS prev,
           COALESCE(t.actual_qty, t.planned_qty, 0) AS qty
    FROM tasks t JOIN users u ON u.id = t.executed_by_user_id
    WHERE t.status = 'Completed' AND t.finished_at >= ${r.fromIso} AND t.finished_at < ${r.toIso} AND ${whIn("t.warehouse_id", wh)}`);
  return rows.map((x) => ({ id: x.id, type: x.type, userId: x.uid, user: x.user, day: x.fin.slice(0, 10), qty: Number(x.qty), mins: taskMinutes(x.started, x.fin, x.prev) ?? MIN_TASK_MINUTES }));
}

export const TASKS_GRID = "/tasks/order-operations";
/** Count and Replenishment tasks live on their own Task Details tabs. */
const KIND_GRID: Readonly<Record<string, string>> = { Count: "/tasks/count", Replenishment: "/tasks/replenishment" };
export const taskGridOf = (types: readonly string[]): string => {
  const grids = new Set(types.map((t) => KIND_GRID[t] ?? TASKS_GRID));
  return grids.size === 1 ? [...grids][0] as string : TASKS_GRID;
};
export const tasksHref = (r: Range, extra: string, grid: string = TASKS_GRID) => `${grid}?f.status=in:Completed&${rangeFilter("finishedAt", r)}${extra}`;
/** Completed tasks finished on one day (the line charts' per-day drilldown). */
export const tasksDayHref = (day: string, extra = "") => `${TASKS_GRID}?f.status=in:Completed&${dayFilter("finishedAt", day)}${extra}`;
const enc = encodeURIComponent;

interface UserAgg { userId: string; user: string; tasks: number; units: number; mins: number; byType: Map<string, number>; byDay: Map<string, number> }

export function aggregateUsers(facts: readonly TaskFact[]): UserAgg[] {
  const m = new Map<string, UserAgg>();
  for (const f of facts) {
    const a = m.get(f.userId) ?? { userId: f.userId, user: f.user, tasks: 0, units: 0, mins: 0, byType: new Map(), byDay: new Map() };
    a.tasks += 1; a.units += f.qty; a.mins += f.mins;
    a.byType.set(f.type, (a.byType.get(f.type) ?? 0) + 1);
    a.byDay.set(f.day, (a.byDay.get(f.day) ?? 0) + 1);
    m.set(f.userId, a);
  }
  return [...m.values()].sort((a, b) => b.tasks - a.tasks);
}

/** Tasks per hour of measured task time. */
export const speedOf = (tasks: number, mins: number): number => (mins > 0 ? round(tasks / (mins / 60), 1) : 0);

function typesOf(facts: readonly TaskFact[]): string[] {
  const counts = new Map<string, number>();
  for (const f of facts) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

function averageTask(facts: readonly TaskFact[], r: Range): { kpis: AnalyticsKpi[]; charts: AnalyticsChart[] } {
  const types = typesOf(facts);
  const series = types.map((t, i) => ({ key: t, label: t, color: PALETTE[i % PALETTE.length] as string }));
  const trend: AnalyticsRow[] = r.days.map((day) => {
    const row: Record<string, string | number | null> = { day };
    let all = 0; let n = 0;
    for (const t of types) {
      const xs = facts.filter((f) => f.day === day && f.type === t);
      row[t] = xs.length ? round(xs.reduce((a, f) => a + f.mins, 0) / xs.length, 2) : null;
      all += xs.reduce((a, f) => a + f.mins, 0); n += xs.length;
    }
    row.overall = n ? round(all / n, 2) : null;
    row.tasks = n;
    row.href = tasksDayHref(day);
    return row;
  });
  const byType: AnalyticsRow[] = types.map((t) => {
    const xs = facts.filter((f) => f.type === t);
    const mins = xs.reduce((a, f) => a + f.mins, 0);
    return { type: t, tasks: xs.length, avgMinutes: round(mins / Math.max(xs.length, 1), 2), totalHours: round(mins / 60, 1), href: tasksHref(r, `&f.taskType=in:${enc(t)}`, taskGridOf([t])) };
  });
  const totalMins = facts.reduce((a, f) => a + f.mins, 0);
  return {
    kpis: [
      { label: "Tasks completed", value: fmtInt(facts.length), href: tasksHref(r, "") },
      { label: "Average task time", value: `${round(totalMins / Math.max(facts.length, 1), 2)} min`, hint: `Across ${fmtInt(facts.length)} completed tasks`, href: tasksHref(r, "") },
      { label: "Measured hours", value: `${round(totalMins / 60, 1)} h`, href: tasksHref(r, "") },
      { label: "Task types", value: String(types.length), hint: types.slice(0, 3).join(", ") || undefined, href: tasksHref(r, "") },
    ],
    charts: [
      { id: "trend", title: "Average task time by day", description: "Average minutes per task, per task type, with the overall trend line. Click a day to open its tasks.", kind: "line", xKey: "day", wide: true,
        series: [...series, { key: "overall", label: "All tasks (trend)", color: "#1C2333" }], rows: trend, hrefKey: "href",
        columns: [{ key: "day", label: "Day" }, ...types.map((t) => ({ key: t, label: `${t} (min)`, kind: "minutes" as const })), { key: "overall", label: "All tasks (min)", kind: "minutes" }, { key: "tasks", label: "Tasks", kind: "number" }],
        gridHref: tasksHref(r, ""), gridLabel: "Open completed tasks" },
      { id: "by-type", title: "Average by task type", description: "Average minutes per task over the whole period. Click a bar to open those tasks.", kind: "bar", xKey: "type",
        series: [{ key: "avgMinutes", label: "Avg minutes", color: PALETTE[0] }], rows: byType, hrefKey: "href",
        columns: [{ key: "type", label: "Task type" }, { key: "tasks", label: "Tasks", kind: "number" }, { key: "avgMinutes", label: "Avg minutes", kind: "minutes" }, { key: "totalHours", label: "Total hours", kind: "hours" }],
        gridHref: tasksHref(r, ""), gridLabel: "Open completed tasks" },
    ],
  };
}

function associateTask(facts: readonly TaskFact[], r: Range): { kpis: AnalyticsKpi[]; charts: AnalyticsChart[] } {
  const types = typesOf(facts);
  const users = aggregateUsers(facts);
  const rows: AnalyticsRow[] = users.map((u) => {
    const row: Record<string, string | number | null> = { user: u.user, total: u.tasks, href: tasksHref(r, `&f.executedBy=eq:${enc(u.user)}`) };
    for (const t of types) row[t] = u.byType.get(t) ?? 0;
    return row;
  });
  return {
    kpis: [
      { label: "Associates", value: String(users.length), hint: "Completed at least one task", href: tasksHref(r, "") },
      { label: "Tasks completed", value: fmtInt(facts.length), href: tasksHref(r, "") },
      { label: "Tasks per associate", value: fmtInt(facts.length / Math.max(users.length, 1)), href: tasksHref(r, "") },
      { label: "Top associate", value: users[0]?.user ?? "—", hint: users[0] ? `${fmtInt(users[0].tasks)} tasks` : undefined, href: users[0] ? tasksHref(r, `&f.executedBy=eq:${enc(users[0].user)}`) : undefined },
    ],
    charts: [{
      id: "per-user", title: "Tasks per associate by type", description: "Stacked by task type. Click an associate to open their tasks.", kind: "stackedBar", xKey: "user", wide: true,
      series: types.map((t, i) => ({ key: t, label: t, color: PALETTE[i % PALETTE.length] as string })), rows, hrefKey: "href",
      columns: [{ key: "user", label: "Associate" }, ...types.map((t) => ({ key: t, label: t, kind: "number" as const })), { key: "total", label: "Total", kind: "number" }],
      gridHref: tasksHref(r, ""), gridLabel: "Open completed tasks",
    }],
  };
}

export const QUADRANT_LABELS = ["Top performers", "Fast, low volume", "High volume, slower", "Needs coaching"] as const;

export function quadrantOf(speed: number, volume: number, med: { x: number; y: number }): string {
  if (volume >= med.x && speed >= med.y) return QUADRANT_LABELS[0];
  if (volume < med.x && speed >= med.y) return QUADRANT_LABELS[1];
  if (volume >= med.x) return QUADRANT_LABELS[2];
  return QUADRANT_LABELS[3];
}

function quadrant(facts: readonly TaskFact[], r: Range): { kpis: AnalyticsKpi[]; charts: AnalyticsChart[] } {
  const users = aggregateUsers(facts);
  const points = users.map((u) => ({ user: u.user, volume: u.tasks, speed: speedOf(u.tasks, u.mins) }));
  const med = { x: median(points.map((p) => p.volume)), y: round(median(points.map((p) => p.speed)), 1) };
  const rows: AnalyticsRow[] = points.map((p) => ({ ...p, quadrant: quadrantOf(p.speed, p.volume, med), href: tasksHref(r, `&f.executedBy=eq:${enc(p.user)}`) }));
  const usersIn = (q: string) => rows.filter((x) => x.quadrant === q).map((x) => String(x.user));
  const groupHref = (names: readonly string[]) => (names.length ? tasksHref(r, `&f.executedBy=in:${names.map(enc).join(",")}`) : undefined);
  return {
    kpis: [
      { label: "Median volume", value: `${fmtInt(med.x)} tasks`, hint: `${rows.length} associates`, href: tasksHref(r, "") },
      { label: "Median speed", value: `${med.y} tasks/h`, href: tasksHref(r, "") },
      { label: "Top performers", value: String(usersIn(QUADRANT_LABELS[0]).length), hint: usersIn(QUADRANT_LABELS[0]).slice(0, 3).join(", ") || undefined, href: groupHref(usersIn(QUADRANT_LABELS[0])) },
      { label: "Needs coaching", value: String(usersIn(QUADRANT_LABELS[3]).length), hint: usersIn(QUADRANT_LABELS[3]).slice(0, 3).join(", ") || undefined, href: groupHref(usersIn(QUADRANT_LABELS[3])) },
    ],
    charts: [{
      id: "quadrant", title: "Speed vs volume", description: "Each dot is an associate. Dashed lines are the team medians.", kind: "scatter", xKey: "volume", yKey: "speed", wide: true,
      series: [{ key: "speed", label: "Associates", color: PALETTE[0] }], rows, hrefKey: "href", medians: med, quadrants: [...QUADRANT_LABELS] as unknown as readonly [string, string, string, string],
      columns: [{ key: "user", label: "Associate" }, { key: "volume", label: "Tasks completed", kind: "number" }, { key: "speed", label: "Tasks per hour", kind: "decimal" }, { key: "quadrant", label: "Quadrant" }],
    }],
  };
}

function bestSpeedKpi(rows: readonly AnalyticsRow[]): AnalyticsKpi {
  const best = [...rows].sort((a, b) => Number(b.speed) - Number(a.speed))[0];
  return best ? { label: "Best speed", value: `${best.speed} tasks/h`, hint: String(best.user), href: String(best.href) } : { label: "Best speed", value: "—" };
}

function associates(facts: readonly TaskFact[], r: Range): { kpis: AnalyticsKpi[]; charts: AnalyticsChart[] } {
  const users = aggregateUsers(facts);
  const rows: AnalyticsRow[] = users.map((u, i) => ({
    rank: i + 1, user: u.user, tasks: u.tasks, units: u.units, speed: speedOf(u.tasks, u.mins), avgMinutes: round(u.mins / Math.max(u.tasks, 1), 2),
    hours: round(u.mins / 60, 1), activeDays: u.byDay.size, spark: r.days.map((d) => u.byDay.get(d) ?? 0).join(","),
    href: tasksHref(r, `&f.executedBy=eq:${enc(u.user)}`),
  }));
  return {
    kpis: [
      { label: "Associates", value: String(users.length), href: tasksHref(r, "") },
      { label: "Units handled", value: fmtInt(users.reduce((a, u) => a + u.units, 0)), href: tasksHref(r, "") },
      { label: "Team speed", value: `${speedOf(facts.length, facts.reduce((a, f) => a + f.mins, 0))} tasks/h`, href: tasksHref(r, "") },
      bestSpeedKpi(rows),
    ],
    charts: [{
      id: "scorecards", title: "Associate scorecards", description: "Ranked by tasks completed. The sparkline shows tasks per day across the period.", kind: "scorecards", xKey: "user", wide: true,
      series: [{ key: "tasks", label: "Tasks", color: PALETTE[0] }], rows, hrefKey: "href",
      columns: [{ key: "rank", label: "Rank", kind: "number" }, { key: "user", label: "Associate" }, { key: "tasks", label: "Tasks", kind: "number" }, { key: "units", label: "Units", kind: "number" },
        { key: "speed", label: "Tasks per hour", kind: "decimal" }, { key: "avgMinutes", label: "Avg task (min)", kind: "minutes" }, { key: "hours", label: "Hours", kind: "hours" }, { key: "activeDays", label: "Active days", kind: "number" }],
    }],
  };
}

function receivingPerformance(db: AppDb, r: Range, wh: readonly string[]): { kpis: AnalyticsKpi[]; charts: AnalyticsChart[] } {
  const rows = db.all<{ user: string; d: string; units: number; lines: number; first: string; last: string }>(sql`
    SELECT COALESCE(u.name, r.received_by) AS user, substr(r.received_at, 1, 10) AS d, SUM(r.uom_quantity) AS units, COUNT(*) AS lines,
           MIN(r.received_at) AS first, MAX(r.received_at) AS last
    FROM receipts r LEFT JOIN users u ON u.email = r.received_by OR u.id = r.received_by
    WHERE r.cancelled_at IS NULL AND r.type IN ('Purchase Order', 'Return', 'Product Receive') AND r.received_at >= ${r.fromIso} AND r.received_at < ${r.toIso} AND ${whIn("r.warehouse_id", wh)}
    GROUP BY 1, 2`);
  // Dock hours per user-day: first → last receipt, at least 15 minutes.
  const per = new Map<string, { units: number; lines: number; hours: number; days: number }>();
  for (const x of rows) {
    const h = Math.max((Date.parse(x.last) - Date.parse(x.first)) / 3_600_000, 0.25);
    const a = per.get(x.user) ?? { units: 0, lines: 0, hours: 0, days: 0 };
    per.set(x.user, { units: a.units + Number(x.units), lines: a.lines + Number(x.lines), hours: a.hours + h, days: a.days + 1 });
  }
  const href = `${RECEIVING_GRID}?${rangeFilter("receivedAt", r)}`;
  const out: AnalyticsRow[] = [...per.entries()].sort((a, b) => b[1].units - a[1].units).map(([user, a]) => ({
    user, units: a.units, lines: a.lines, hours: round(a.hours, 1), unitsPerHour: round(a.units / a.hours, 1), linesPerHour: round(a.lines / a.hours, 1), days: a.days, href,
  }));
  const units = out.reduce((s, x) => s + Number(x.units), 0);
  const hours = out.reduce((s, x) => s + Number(x.hours), 0);
  const daily: AnalyticsRow[] = r.days.map((day) => ({
    day, units: rows.filter((x) => x.d === day).reduce((s, x) => s + Number(x.units), 0), lines: rows.filter((x) => x.d === day).reduce((s, x) => s + Number(x.lines), 0),
    href: `${RECEIVING_GRID}?${dayFilter("receivedAt", day)}`,
  }));
  return {
    kpis: [
      { label: "Units received", value: fmtInt(units), href },
      { label: "Receipt lines", value: fmtInt(out.reduce((s, x) => s + Number(x.lines), 0)), href },
      { label: "Units per dock hour", value: hours ? fmtInt(units / hours) : "—", hint: `${round(hours, 1)} dock hours`, href },
      { label: "Receivers", value: String(out.length), href },
    ],
    charts: [
      { id: "per-user", title: "Units and lines per hour by associate", description: "Dock hours run from each associate's first to last receipt of the day.", kind: "bar", xKey: "user",
        series: [{ key: "unitsPerHour", label: "Units / hour", color: PALETTE[0] }, { key: "linesPerHour", label: "Lines / hour", color: PALETTE[1] }], rows: out, hrefKey: "href",
        columns: [{ key: "user", label: "Associate" }, { key: "units", label: "Units", kind: "number" }, { key: "lines", label: "Lines", kind: "number" }, { key: "hours", label: "Dock hours", kind: "hours" },
          { key: "unitsPerHour", label: "Units / hour", kind: "decimal" }, { key: "linesPerHour", label: "Lines / hour", kind: "decimal" }],
        gridHref: href, gridLabel: "Open receiving history" },
      { id: "daily", title: "Units received per day", description: "All receivers combined. Click a day to open its receipts.", kind: "area", xKey: "day",
        series: [{ key: "units", label: "Units", color: PALETTE[0] }], rows: daily, hrefKey: "href",
        columns: [{ key: "day", label: "Day" }, { key: "units", label: "Units", kind: "number" }, { key: "lines", label: "Lines", kind: "number" }], gridHref: href, gridLabel: "Open receiving history" },
    ],
  };
}

export function buildLabor(db: AppDb, page: LaborPage, r: Range, wh: readonly string[]): { kpis: AnalyticsKpi[]; charts: AnalyticsChart[] } {
  if (page === "receiving-performance") return receivingPerformance(db, r, wh);
  const facts = loadTaskFacts(db, r, wh);
  if (page === "average-task") return averageTask(facts, r);
  if (page === "associate-task") return associateTask(facts, r);
  if (page === "performance-quadrant") return quadrant(facts, r);
  return associates(facts, r);
}
