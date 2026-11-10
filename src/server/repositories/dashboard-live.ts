/**
 * Live dashboard (BUILD_PLAN M13 §1, spec 08 §Dashboard). Every order number is computed
 * with the SAME predicate the Shipment Orders grid uses (`viewCondition` + scope +
 * `compileOrderGrid` over the grid grammar), and every value carries the `/orders` deep
 * link built from that grammar, so a drilldown always opens exactly the counted orders.
 */
import { and, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { scopedWhere, type Scope } from "@/server/auth/scope";
import { schema } from "@/server/db";
import { parseGridQuery, serializeGridQuery, type GridFilter } from "@/server/query/grid-query";
import { can } from "@/server/auth/permissions";
import { TASK_TYPES_BY_KIND } from "@/lib/grid-defs/jobs/tasks";
import { LINE_STATES, lineStateCaseSql, type LineState } from "@/lib/grid-defs/reports/order-lines";
import { SNAPSHOT_DEF } from "@/lib/grid-defs/reports/inventory";
import { compileOrderGrid } from "./orders-grid";
import { viewCondition } from "./orders";
import { snapshotCoverage } from "./reports-inventory";
import { isValidTimeZone, localMidnightUtc, localParts } from "@/server/scheduler/timezone";

const so = schema.shipmentOrders;

export interface DashboardSelection {
  readonly warehouseIds: readonly string[];
  readonly clientIds: readonly string[];
}

export interface Metric {
  readonly label: string;
  readonly count: number;
  readonly href: string;
  readonly packQty?: number;
}

export interface Progress {
  readonly done: number;
  readonly total: number;
  readonly href: string;
  /** Drilldowns whose counts are exactly `done` and `total - done` (tasks). */
  readonly doneHref?: string;
  readonly openHref?: string;
  /**
   * Drilldown links shown under the bar. Each part's `count` is exactly the Total of the grid
   * its href opens (critic R2: no link may open a different number than the one shown).
   */
  readonly parts?: readonly ProgressPart[];
  /** What `done` / `total` count, e.g. "lines" (the bar caption). */
  readonly unit?: string;
}

export interface ProgressPart {
  readonly label: string;
  readonly count: number;
  /** Absent when no grid lists exactly these rows (order lines): rendered as plain text. */
  readonly href?: string;
  readonly tone?: "done" | "open";
  readonly title?: string;
}

/**
 * Disjoint order-line split for the "Order Lines" progress row: every line is in exactly
 * one bucket, so the three counts add up to the total.
 */
export function lineParts(row: { total: number; packed: number; picked: number }, hrefOf?: (state: LineState) => string): ProgressPart[] {
  const packed = Math.max(0, Math.min(row.packed, row.total));
  const pickedOnly = Math.max(0, Math.min(row.picked, row.total) - packed);
  const notPicked = Math.max(0, row.total - packed - pickedOnly);
  const link = (state: LineState) => (hrefOf ? { href: hrefOf(state) } : {});
  return [
    { label: "packed", count: packed, tone: "done", title: "Open the lines that are fully packed", ...link("Packed") },
    { label: "picked, not packed", count: pickedOnly, tone: "open", title: "Open the lines that are picked and waiting to be packed", ...link("Picked, not packed") },
    { label: "not picked yet", count: notPicked, tone: "open", title: "Open the lines still to be picked", ...link("Not picked") },
  ];
}

/** Order Line Progress grid URL for one line state, with the dashboard's selection filters. */
export function orderLinesHref(state: LineState | null, base: readonly GridFilter[]): string {
  const filters: GridFilter[] = [...base];
  if (state) filters.unshift({ field: "lineState", op: "in", values: [state] });
  const qs = serializeGridQuery({ filters });
  return qs ? `/reports/order-lines?${qs}` : "/reports/order-lines";
}

/* ------------------------------------------------------------ business day */

const addDayStr = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Business-day calendar of the dashboard (critic R5): every "today", "tomorrow" and age
 * bucket is a LOCAL day in the warehouse zone, never a UTC day, so after 7-8 PM Eastern
 * "Already Shipped Today" does not roll over to tomorrow. Drilldowns carry the exact ISO
 * bounds (`date:custom:<start>..<end>` with a Z suffix), so the grids they open count the
 * same rows whatever zone the grid itself resolves presets in.
 */
export interface DashboardDays {
  readonly tz: string;
  /** Local calendar day `offset` days from today (YYYY-MM-DD). */
  readonly day: (offset: number) => string;
  /** UTC instant of local midnight starting that day. */
  readonly start: (offset: number) => string;
  /** Last millisecond of that local day (inclusive end). */
  readonly end: (offset: number) => string;
}

export function dashboardDays(tzIn: string, now: Date = new Date()): DashboardDays {
  const tz = isValidTimeZone(tzIn) ? tzIn : "UTC";
  const today = localParts(now, tz).date;
  const day = (o: number) => addDayStr(today, o);
  const start = (o: number) => localMidnightUtc(day(o), tz).toISOString();
  const end = (o: number) => new Date(localMidnightUtc(day(o + 1), tz).getTime() - 1).toISOString();
  return { tz, day, start, end };
}

/** `date:custom:` spec covering local days `from..to` (either side open when null). */
export const daySpan = (d: DashboardDays, from: number | null, to: number | null): string =>
  `date:custom:${from === null ? "" : d.start(from)}..${to === null ? "" : d.end(to)}`;

/**
 * The zone the dashboard's days are computed in: the selected warehouses' zone, or (when
 * they differ) the zone of the first warehouse by code. `mixed` tells the UI to say so.
 */
export function dashboardZone(db: AppDb, warehouseIds: readonly string[]): { readonly tz: string; readonly mixed: boolean; readonly label: string | null } {
  if (warehouseIds.length === 0) return { tz: "UTC", mixed: false, label: null };
  const rows = db.all<{ code: string; tz: string | null }>(sql`SELECT code, timezone AS tz FROM warehouses
    WHERE id IN (${sql.join(warehouseIds.map((id) => sql`${id}`), sql`, `)}) ORDER BY code`);
  const zoneOf = (tz: string | null | undefined): string => (tz && isValidTimeZone(tz) ? tz : "UTC");
  const zones = [...new Set(rows.map((r) => zoneOf(r.tz)))];
  const first = rows[0];
  return { tz: zoneOf(first?.tz), mixed: zones.length > 1, label: zones.length > 1 ? first?.code ?? null : null };
}

const SHIPPED_IN = `f.status=in:${["Shipped", "Partially Shipped", "Delivered"].map((s) => encodeURIComponent(s)).join(",")}`;

/** "Shipped today" in the dashboard's business day (exact ISO bounds). */
export const shippedTodayQs = (d: DashboardDays): string => `${SHIPPED_IN}&f.shippedAt=${daySpan(d, 0, 0)}`;

/**
 * The order predicate behind the "Order Lines" progress row and the Order Line Progress
 * grid: backlog orders OR orders shipped today, in `scope`, with `base` selection filters.
 * Both read this one function, so a dashboard part and the grid it opens always agree.
 */
export function dashboardLinesWhere(scope: Scope, base: readonly GridFilter[], days: DashboardDays): SQL {
  const backlog = orderWhere({ scope }, "backlog", base);
  const shippedToday = orderWhere({ scope }, "shipped", [...base, ...parseFilters(shippedTodayQs(days))]);
  return sql`((${backlog}) OR (${shippedToday}))`;
}

/** Line state CASE over `order_lines l` (the same expression the grid filters on). */
export const LINE_STATE_SQL = sql.raw(lineStateCaseSql("l"));

export interface RankRow {
  readonly name: string;
  readonly count: number;
  readonly pct: number;
  readonly href: string | null;
  /** The empty bucket (e.g. no carrier yet): rendered muted, not as a ranked value. */
  readonly muted?: boolean;
}

export interface JobRow {
  readonly name: string;
  readonly productQty: number;
  readonly orderQty: number;
  readonly jobQty: number;
  readonly pct: number;
  readonly href: string;
  /** No value (e.g. no priority set): neutral text, not an accent drilldown. */
  readonly muted?: boolean;
}

export interface SnapshotGap {
  readonly warehouseId: string;
  readonly warehouse: string;
  readonly missingDays: readonly string[];
  readonly href: string;
}

/** Nights looked back over for the dashboard's snapshot alert. */
export const SNAPSHOT_ALERT_DAYS = 7;

/** Recent snapshot gaps (business days within SNAPSHOT_ALERT_DAYS of the latest run) per warehouse in scope. */
export function snapshotGaps(db: AppDb, auth: AuthContext, scope: Scope, days: DashboardDays = dashboardDays("UTC")): SnapshotGap[] {
  if (!can(auth, SNAPSHOT_DEF.permission as Parameters<typeof can>[1])) return [];
  const cutoff = days.day(-SNAPSHOT_ALERT_DAYS);
  return snapshotCoverage(db, auth)
    .filter((c) => scope.warehouseIds.includes(c.warehouseId))
    .map((c) => ({ warehouseId: c.warehouseId, warehouse: c.warehouse, missingDays: c.missingDays.filter((d) => d >= cutoff), href: `/reports/inventory-snapshot?f.warehouseId=in:${encodeURIComponent(c.warehouseId)}` }))
    .filter((g) => g.missingDays.length > 0);
}

export interface ShiftInfo {
  readonly warehouseId: string;
  readonly warehouseLabel: string;
  readonly timeZone: string;
  readonly start: string;
  readonly end: string;
}

export interface LiveDashboard {
  readonly asOf: string;
  /**
   * Business day every "today" / "tomorrow" figure uses: the local date in `timeZone` (the
   * selected warehouses' zone; `mixedZones` when they differ and the first warehouse's zone,
   * `zoneWarehouse`, is used).
   */
  readonly businessDay: { readonly date: string; readonly timeZone: string; readonly mixedZones: boolean; readonly zoneWarehouse: string | null };
  readonly selection: { readonly warehouseIds: readonly string[]; readonly clientIds: readonly string[] | "all" };
  readonly shift: ShiftInfo | null;
  /** Day shift of every selected warehouse (aggregate view when more than one is selected). */
  readonly shifts: readonly ShiftInfo[];
  readonly progress: { readonly tasks: Progress; readonly lines: Progress; readonly ordersToday: Progress };
  readonly unfulfilled: { readonly total: Metric; readonly open: Metric; readonly inProgress: Metric };
  /** Unfulfilled orders (Open + In Progress) by order age; the buckets add up to the total. */
  readonly unfulfilledAge: readonly Metric[];
  readonly breakdown: readonly (readonly Metric[])[];
  /** All backlog orders: equals the sum of the breakdown's backlog status lines and of every backlog rank card. */
  readonly backlogTotal: Metric;
  readonly ranks: {
    readonly channels: readonly RankRow[]; readonly clients: readonly RankRow[]; readonly carriers: readonly RankRow[]; readonly countries: readonly RankRow[];
    /** Carriers ranked by orders shipped in the last 7 days (the backlog is mostly carrier-less before rating). */
    readonly carriersShipped: readonly RankRow[];
  };
  /** Warehouses in the selection whose nightly inventory snapshot is missing for a recent night (viewers with the snapshot report only). */
  readonly snapshotGaps: readonly SnapshotGap[];
  readonly jobs: { readonly priority: readonly JobRow[]; readonly status: readonly JobRow[]; readonly type: readonly JobRow[] };
}

export const IN_PROGRESS_STATUSES = ["Ready to Pick", "Picking Started", "Ready to Pack", "Packing Started", "Ready to Sort", "Sorting Started", "Ready to Load", "Loading Started", "Ready to Ship"] as const;
const PACKED_STATUSES = ["Ready to Load", "Loading Started", "Ready to Ship"] as const;
export const RANK_LIMIT = 5;

/** Selection ∩ the viewer's scope; an empty selection means the header context (viewScope). */
export function effectiveScope(auth: AuthContext, sel: DashboardSelection): Scope {
  const wh = sel.warehouseIds.filter((id) => auth.scope.warehouseIds.includes(id));
  const allowedClient = (id: string) => auth.scope.clientIds === "all" || auth.scope.clientIds.includes(id);
  const cl = sel.clientIds.filter(allowedClient);
  return {
    warehouseIds: wh.length > 0 ? wh : auth.viewScope.warehouseIds,
    clientIds: cl.length > 0 ? cl : auth.viewScope.clientIds,
  };
}

function scopeFilters(scope: Scope, sel: DashboardSelection): GridFilter[] {
  const out: GridFilter[] = [];
  if (sel.warehouseIds.length > 0) out.push({ field: "warehouseId", op: "in", values: [...scope.warehouseIds] });
  if (sel.clientIds.length > 0 && scope.clientIds !== "all") out.push({ field: "clientId", op: "in", values: [...scope.clientIds] });
  return out;
}

const parseFilters = (qs: string): GridFilter[] => [...parseGridQuery(qs).query.filters];

interface Ctx {
  readonly db: AppDb;
  readonly scope: Scope;
  readonly base: readonly GridFilter[];
  readonly days: DashboardDays;
}

function orderWhere(ctx: Pick<Ctx, "scope">, view: "backlog" | "shipped", filters: readonly GridFilter[]): SQL {
  const grid = compileOrderGrid({ qm: "sw", filters, sort: [], page: 1, pageSize: 1 });
  return and(viewCondition(view), scopedWhere(so, ctx.scope), grid.where) as SQL;
}

function orderHref(view: "backlog" | "shipped", filters: readonly GridFilter[]): string {
  const qs = serializeGridQuery({ filters });
  const path = view === "shipped" ? "/orders/shipped" : "/orders";
  return qs ? `${path}?${qs}` : path;
}

function metric(ctx: Ctx, label: string, view: "backlog" | "shipped", extra: string): Metric {
  const filters = [...ctx.base, ...parseFilters(extra)];
  const row = ctx.db.get<{ n: number; qty: number }>(sql`SELECT COUNT(*) AS n, COALESCE(SUM(total_quantity), 0) AS qty FROM shipment_orders WHERE ${orderWhere(ctx, view, filters)}`);
  return { label, count: Number(row?.n ?? 0), packQty: Number(row?.qty ?? 0), href: orderHref(view, filters) };
}

const inStatuses = (statuses: readonly string[]): string => `f.status=in:${statuses.map((s) => encodeURIComponent(s)).join(",")}`;

/**
 * Order-age buckets for the unfulfilled backlog as Order Date filters, in local business days
 * with exact ISO bounds. Disjoint and exhaustive (today, 1-2, 3-6, 7+ days), so the bucket
 * counts add up to the Unfulfilled total and each drilldown opens exactly the orders it counts.
 */
export function unfulfilledAgeBuckets(days: DashboardDays): readonly { readonly label: string; readonly date: string }[] {
  return [
    { label: "Ordered today", date: daySpan(days, 0, null) },
    { label: "1-2 days old", date: daySpan(days, -2, -1) },
    { label: "3-6 days old", date: daySpan(days, -6, -3) },
    { label: "7+ days old", date: daySpan(days, null, -7) },
  ];
}

function unfulfilledAge(ctx: Ctx): Metric[] {
  const statuses = inStatuses(["Open", ...IN_PROGRESS_STATUSES]);
  return unfulfilledAgeBuckets(ctx.days).map((b) => metric(ctx, b.label, "backlog", `${statuses}&f.orderDate=${b.date}`));
}

/** Backlog statuses Logiwa's breakdown has no fixed line for: shown only when they hold orders. */
export const OPTIONAL_BREAKDOWN_STATUSES = ["Ready to Sort", "Sorting Started", "Loading Started"] as const;

/** Every backlog status the breakdown lists, so its status lines add up to the backlog total. */
export const BREAKDOWN_BACKLOG_STATUSES = [
  "Open", "Ready to Pick", "Picking Started",
  "Ready to Pack", "Packing Started", "Ready to Sort", "Sorting Started", "Ready to Load", "Loading Started", "Ready to Ship",
  "Shortage", "On Hold", "Partially Shipped",
] as const;

function breakdown(ctx: Ctx): Metric[][] {
  const s = (label: string, status: string) => metric(ctx, label, "backlog", inStatuses([status]));
  const optional = (status: (typeof OPTIONAL_BREAKDOWN_STATUSES)[number]) => {
    const m = s(status, status);
    return m.count > 0 ? [m] : [];
  };
  return [
    [s("Open", "Open"), s("Ready to Pick", "Ready to Pick"), s("Picking Started", "Picking Started")],
    [
      s("Ready to Pack", "Ready to Pack"), s("Packing Started", "Packing Started"),
      ...optional("Ready to Sort"), ...optional("Sorting Started"),
      s("Ready to Load", "Ready to Load"), ...optional("Loading Started"), s("Ready to Ship", "Ready to Ship"),
    ],
    [
      metric(ctx, "Cancelled Today", "shipped", `${inStatuses(["Cancelled"])}&f.cancelledAt=${daySpan(ctx.days, 0, 0)}`),
      s("Shortage", "Shortage"),
      s("On Hold", "On Hold"),
      // Partly shipped orders stay in the backlog (and in the rank cards) until the rest ships.
      s("Partially Shipped", "Partially Shipped"),
    ],
    [
      metric(ctx, "Already Shipped Today", "shipped", shippedTodayQs(ctx.days)),
      metric(ctx, "Orders to be Shipped Today", "backlog", `f.expectedShipDate=${daySpan(ctx.days, null, 0)}`),
      metric(ctx, "Orders to be Shipped Tomorrow", "backlog", `f.expectedShipDate=${daySpan(ctx.days, 1, 1)}`),
    ],
  ];
}

/** Label for each rank card's empty bucket. */
export const EMPTY_RANK_LABEL: Readonly<Record<string, string>> = { carrier: "No carrier assigned yet", channel: "No channel", shipCountry: "No ship-to country" };

/**
 * Top RANK_LIMIT named values (ranked 1..N), then "Others", then the empty bucket (e.g. no
 * carrier yet) as a muted summary line at the bottom: it is never ranked and never numbered.
 * Percentages are of every counted order, so the rows still add up to 100 %.
 */
export function rankRows(
  rows: readonly { readonly name: string | null; readonly n: number }[],
  link: (name: string | null) => string,
  emptyLabel = "Not set",
  othersLink?: (excluded: readonly string[]) => string,
): RankRow[] {
  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 10000) / 100 : 0);
  const named = rows.filter((r) => r.name !== null && r.name !== "").sort((a, b) => Number(b.n) - Number(a.n) || String(a.name).localeCompare(String(b.name)));
  const empty = rows.filter((r) => r.name === null || r.name === "").reduce((a, r) => a + Number(r.n), 0);
  const top: RankRow[] = named.slice(0, RANK_LIMIT).map((r) => ({ name: r.name as string, count: Number(r.n), pct: pct(Number(r.n)), href: link(r.name) }));
  const rest = named.slice(RANK_LIMIT).reduce((a, r) => a + Number(r.n), 0);
  if (rest > 0) top.push({ name: "Others", count: rest, pct: pct(rest), href: othersLink ? othersLink(named.slice(0, RANK_LIMIT).map((r) => r.name as string)) : null });
  if (empty > 0) top.push({ name: emptyLabel, count: empty, pct: pct(empty), href: link(null), muted: true });
  return top;
}

function ranks(ctx: Ctx, expr: SQL, field: string, kind: "enum" | "text", view: "backlog" | "shipped" = "backlog", extra = ""): RankRow[] {
  const filters = [...ctx.base, ...(extra ? parseFilters(extra) : [])];
  const where = orderWhere(ctx, view, filters);
  const rows = ctx.db.all<{ name: string | null; n: number }>(sql`SELECT ${expr} AS name, COUNT(*) AS n FROM shipment_orders WHERE ${where} GROUP BY 1 ORDER BY n DESC, name`);
  const link = (name: string | null): string => {
    const f: GridFilter = name === null || name === ""
      ? { field, op: "empty" }
      : kind === "enum" ? { field, op: "in", values: [name] } : { field, op: "eq", value: name };
    return orderHref(view, [...filters, f]);
  };
  // "Others" = every named value outside the top N: an `in:` list of exactly those values,
  // so its drilldown opens exactly the orders it counts (never the empty bucket).
  const named = rows.filter((r) => r.name !== null && r.name !== "").map((r) => r.name as string);
  const others = (top: readonly string[]): string => {
    const rest = named.filter((n) => !top.includes(n));
    return orderHref(view, [...filters, { field, op: "in", values: rest }]);
  };
  return rankRows(rows, link, EMPTY_RANK_LABEL[field], others);
}

/** Carriers ranked by the orders they shipped (Shipped / Partially Shipped / Delivered) in the last 7 local days. */
export const carrierShippedQs = (d: DashboardDays): string => `${SHIPPED_IN}&f.shippedAt=${daySpan(d, -6, 0)}`;

function clientRanks(ctx: Ctx): RankRow[] {
  const where = orderWhere(ctx, "backlog", ctx.base);
  const rows = ctx.db.all<{ id: string; name: string; n: number }>(sql`SELECT c.id AS id, c.name AS name, COUNT(*) AS n FROM shipment_orders JOIN clients c ON c.id = shipment_orders.client_id WHERE ${where} GROUP BY c.id ORDER BY n DESC, c.name`);
  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 10000) / 100 : 0);
  const base = ctx.base.filter((f) => f.field !== "clientId");
  const top: RankRow[] = rows.slice(0, RANK_LIMIT).map((r) => ({ name: r.name, count: Number(r.n), pct: pct(Number(r.n)), href: orderHref("backlog", [...base, { field: "clientId", op: "in", values: [r.id] }]) }));
  const rest = rows.slice(RANK_LIMIT).reduce((a, r) => a + Number(r.n), 0);
  if (rest === 0) return top;
  // Others = the clients outside the top N (an `in:` list of exactly those clients), so the
  // drilldown opens exactly the orders it counts.
  const restIds = rows.slice(RANK_LIMIT).map((r) => r.id);
  return [...top, { name: "Others", count: rest, pct: pct(rest), href: orderHref("backlog", [...base, { field: "clientId", op: "in", values: restIds }]) }];
}

/** The Order Operations task grid (Picking … Kitting): the Tasks widget counts exactly these. */
export const ORDER_TASK_TYPES = TASK_TYPES_BY_KIND.order;
const TASKS_GRID = "/tasks/order-operations";

/** Warehouse / client name filters for the tasks grid (it filters by name, not id). */
function taskScopeQs(ctx: Ctx): string {
  const names = (table: "warehouses" | "clients", ids: readonly string[]) => ids.length === 0 ? [] :
    ctx.db.all<{ name: string }>(sql`SELECT name FROM ${sql.raw(table)} WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) ORDER BY name`).map((r) => r.name);
  const esc = (v: string) => encodeURIComponent(v.replace(/,/g, "\\,"));
  const wh = names("warehouses", ctx.scope.warehouseIds);
  const cl = ctx.scope.clientIds === "all" ? [] : names("clients", ctx.scope.clientIds);
  return `${wh.length ? `&f.warehouse=in:${wh.map(esc).join(",")}` : ""}${cl.length ? `&f.client=in:${cl.map(esc).join(",")}` : ""}`;
}

function progress(ctx: Ctx): LiveDashboard["progress"] {
  const t0 = ctx.days.start(0);
  const types = sql.join(ORDER_TASK_TYPES.map((x) => sql`${x}`), sql`, `);
  const whereTasks = and(
    scopedWhere(schema.tasks, ctx.scope),
    sql`${schema.tasks.taskType} IN (${types})`,
    sql`${schema.tasks.status} <> 'Cancelled' AND (${schema.tasks.status} IN ('Pending', 'Started') OR (${schema.tasks.status} = 'Completed' AND ${schema.tasks.finishedAt} >= ${t0}))`,
  );
  const t = ctx.db.get<{ total: number; done: number }>(sql`SELECT COUNT(*) AS total, COALESCE(SUM(status = 'Completed'), 0) AS done FROM tasks WHERE ${whereTasks}`);

  const shippedToday = orderWhere(ctx, "shipped", [...ctx.base, ...parseFilters(shippedTodayQs(ctx.days))]);
  // Same predicate and the same line-state CASE as the Order Line Progress grid, so each
  // part's count is exactly that grid's Total.
  const lines = ctx.db.get<{ total: number; done: number; pickedOnly: number }>(sql`
    SELECT COUNT(*) AS total, COALESCE(SUM(${LINE_STATE_SQL} = ${LINE_STATES[0]}), 0) AS done,
           COALESCE(SUM(${LINE_STATE_SQL} = ${LINE_STATES[1]}), 0) AS "pickedOnly"
    FROM order_lines l JOIN shipment_orders ON shipment_orders.id = l.order_id
    WHERE ${dashboardLinesWhere(ctx.scope, ctx.base, ctx.days)}`);

  const dueFilters = [...ctx.base, ...parseFilters(`f.expectedShipDate=${daySpan(ctx.days, null, 0)}`)];
  const due = orderWhere(ctx, "backlog", dueFilters);
  const packedStatuses = sql.raw(`(${PACKED_STATUSES.map((s) => `'${s}'`).join(",")})`);
  const dueRow = ctx.db.get<{ total: number; done: number }>(sql`SELECT COUNT(*) AS total, COALESCE(SUM(status IN ${packedStatuses}), 0) AS done FROM shipment_orders WHERE ${due}`);
  const shippedRow = ctx.db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE ${shippedToday}`);
  const shippedN = Number(shippedRow?.n ?? 0);
  const shippedTodayFilters = [...ctx.base, ...parseFilters(shippedTodayQs(ctx.days))];
  const shippedTodayHref = orderHref("shipped", shippedTodayFilters);
  const scopeQs = taskScopeQs(ctx);
  const openHref = `${TASKS_GRID}?f.status=in:Pending,Started${scopeQs}`;
  const doneHref = `${TASKS_GRID}?f.status=in:Completed&f.finishedAt=${daySpan(ctx.days, 0, 0)}${scopeQs}`;
  const taskDone = Number(t?.done ?? 0);
  const taskTotal = Number(t?.total ?? 0);
  const dueTotal = Number(dueRow?.total ?? 0);
  const duePacked = Number(dueRow?.done ?? 0);
  const packedFilters = [...dueFilters, ...parseFilters(inStatuses(PACKED_STATUSES))];
  const unpackedFilters = [...dueFilters, ...parseFilters(`f.status=nin:${PACKED_STATUSES.map((x) => encodeURIComponent(x)).join(",")}`)];
  const lineTotal = Number(lines?.total ?? 0);
  const lineDone = Number(lines?.done ?? 0);
  return {
    tasks: {
      done: taskDone, total: taskTotal, href: openHref, openHref, doneHref, unit: "tasks",
      parts: [
        { label: "completed today", count: taskDone, href: doneHref, tone: "done", title: "Open the tasks completed today" },
        { label: "open", count: Math.max(taskTotal - taskDone, 0), href: openHref, tone: "open", title: "Open the pending and started tasks" },
      ],
    },
    // Line-level split (disjoint, adds up to the total); each part opens the Order Line
    // Progress grid filtered to that state, whose Total equals the part.
    lines: {
      done: lineDone, total: lineTotal, href: orderLinesHref(null, ctx.base), unit: "lines",
      parts: lineParts({ total: lineTotal, packed: lineDone, picked: lineDone + Number(lines?.pickedOnly ?? 0) }, (state) => orderLinesHref(state, ctx.base)),
    },
    ordersToday: {
      done: duePacked + shippedN, total: dueTotal + shippedN, href: orderHref("backlog", dueFilters), unit: "orders",
      parts: [
        // Disjoint parts: shipped + packed awaiting ship + not yet packed = total.
        { label: "shipped today", count: shippedN, href: shippedTodayHref, tone: "done", title: "Open the orders shipped today" },
        { label: "packed, awaiting ship", count: duePacked, href: orderHref("backlog", packedFilters), tone: "done", title: "Open the due orders that are packed and waiting to ship" },
        { label: "not packed yet", count: Math.max(dueTotal - duePacked, 0), href: orderHref("backlog", unpackedFilters), tone: "open", title: "Open the orders due today or earlier that are not packed yet" },
      ],
    },
  };
}


/** `in:` list value for the grid grammar (commas inside a value are escaped). */
export const inListValue = (values: readonly string[]): string => `in:${values.map((v) => encodeURIComponent(v.replace(/,/g, "\\,"))).join(",")}`;

/**
 * Jobs-grid scope filters for an explicit dashboard selection. The jobs grid filters
 * warehouse and client by name, so every selected id becomes an `in:` list of names (any
 * number of warehouses or clients, not only one). Without a selection the jobs grid
 * applies the same header scope itself, so nothing is added.
 */
function jobScope(ctx: Ctx): { readonly where: SQL | undefined; readonly qs: string } {
  const names = (table: "warehouses" | "clients", ids: readonly string[]) => ids.length === 0 ? [] :
    ctx.db.all<{ name: string }>(sql`SELECT name FROM ${sql.raw(table)} WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) ORDER BY name`).map((r) => r.name);
  const whSel = ctx.base.some((f) => f.field === "warehouseId");
  const clSel = ctx.base.some((f) => f.field === "clientId") && ctx.scope.clientIds !== "all";
  const clientIds = ctx.scope.clientIds === "all" ? [] : ctx.scope.clientIds;
  const wh = whSel ? names("warehouses", ctx.scope.warehouseIds) : [];
  const cl = clSel ? names("clients", clientIds) : [];
  // A client selection counts only that client's jobs (multi-client jobs show as
  // "Multiple" in the grid, so they cannot be part of a client drilldown).
  const where = and(
    scopedWhere(schema.jobs, ctx.scope),
    clSel ? (clientIds.length ? sql`client_id IN (${sql.join(clientIds.map((id) => sql`${id}`), sql`, `)})` : sql`0 = 1`) : undefined,
  );
  return { where, qs: `${wh.length ? `&f.warehouse=${inListValue(wh)}` : ""}${cl.length ? `&f.client=${inListValue(cl)}` : ""}` };
}

function jobRows(ctx: Ctx, groupExpr: SQL, filterField: string, statusFilter: SQL, statusQs: string, valueOf?: (name: string) => string): JobRow[] {
  const scope = jobScope(ctx);
  const rows = ctx.db.all<{ name: string | null; units: number; orders: number; n: number }>(sql`
    SELECT ${groupExpr} AS name, COALESCE(SUM(unit_count), 0) AS units, COALESCE(SUM(order_count), 0) AS orders, COUNT(*) AS n
    FROM jobs WHERE ${and(scope.where, statusFilter)} GROUP BY 1 ORDER BY n DESC, name`);
  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  const wh = scope.qs;
  return rows.map((r) => {
    const blank = r.name === null || r.name === "";
    // Priority "None" is a stored enum value: keep its exact drilldown, but present it as neutral text.
    const noPriority = filterField === "priority" && (blank || r.name === "None");
    const name = noPriority ? "No priority" : blank ? "Not set" : (r.name as string);
    const value = blank ? "empty" : valueOf ? valueOf(r.name as string) : `${filterField === "jobType" ? "eq" : "in"}:${encodeURIComponent(r.name as string)}`;
    return {
      name,
      ...(blank || noPriority ? { muted: true } : {}),
      productQty: Number(r.units),
      orderQty: Number(r.orders),
      jobQty: Number(r.n),
      pct: total > 0 ? Math.round((Number(r.n) / total) * 1000) / 10 : 0,
      href: `/jobs?${statusQs}&f.${filterField}=${value}${wh}`.replace("?&", "?"),
    };
  });
}

function jobs(ctx: Ctx): LiveDashboard["jobs"] {
  const t0 = ctx.days.start(0);
  const open = sql`status IN ('Pending', 'Started', 'In Progress')`;
  const openQs = "f.status=in:Pending,Started";
  // Status tab = open jobs + jobs completed today. Cancelled jobs are left out: they carry
  // no finish date and the jobs grid has no cancelled-at filter (RA-C2-7), so a
  // "cancelled today" row could not open exactly the rows it counted.
  // "In Progress" is shown as "Started", exactly as the jobs grid maps it.
  const statusRows = jobRows(ctx, sql`(CASE WHEN status = 'In Progress' THEN 'Started' ELSE status END)`, "status",
    sql`(status IN ('Pending', 'Started', 'In Progress') OR (status = 'Completed' AND completed_at >= ${t0}))`, "",
    (name) => (name === "Completed" ? `in:Completed&f.completedAt=${daySpan(ctx.days, 0, 0)}` : `in:${encodeURIComponent(name)}`));
  return {
    priority: jobRows(ctx, sql`COALESCE(NULLIF(priority, ''), 'None')`, "priority", open, openQs),
    status: statusRows,
    type: jobRows(ctx, sql`job_type`, "jobType", open, openQs),
  };
}

function shiftInfos(db: AppDb, scope: Scope): ShiftInfo[] {
  if (scope.warehouseIds.length === 0) return [];
  const rows = db.all<{ id: string; code: string; name: string; tz: string; s: string; e: string }>(sql`
    SELECT id, code, name, timezone AS tz, day_shift_start AS s, day_shift_end AS e FROM warehouses
    WHERE id IN (${sql.join(scope.warehouseIds.map((id) => sql`${id}`), sql`, `)}) ORDER BY code`);
  return rows.map((w) => ({ warehouseId: w.id, warehouseLabel: w.name.startsWith(w.code) ? w.name : `${w.code} - ${w.name}`, timeZone: w.tz, start: w.s, end: w.e }));
}

export function getLiveDashboard(db: AppDb, auth: AuthContext, sel: DashboardSelection, now: Date = new Date()): LiveDashboard {
  const scope = effectiveScope(auth, sel);
  const zone = dashboardZone(db, scope.warehouseIds);
  const days = dashboardDays(zone.tz, now);
  const ctx: Ctx = { db, scope, base: scopeFilters(scope, sel), days };
  const open = metric(ctx, "Open", "backlog", inStatuses(["Open"]));
  const inProgress = metric(ctx, "In Progress", "backlog", inStatuses(IN_PROGRESS_STATUSES));
  const total: Metric = {
    label: "Total",
    count: open.count + inProgress.count,
    packQty: (open.packQty ?? 0) + (inProgress.packQty ?? 0),
    href: orderHref("backlog", [...ctx.base, ...parseFilters(inStatuses(["Open", ...IN_PROGRESS_STATUSES]))]),
  };
  return {
    asOf: now.toISOString(),
    businessDay: { date: days.day(0), timeZone: days.tz, mixedZones: zone.mixed, zoneWarehouse: zone.label },
    selection: { warehouseIds: scope.warehouseIds, clientIds: scope.clientIds },
    ...((shifts) => ({ shift: scope.warehouseIds.length === 1 ? shifts[0] ?? null : null, shifts }))(shiftInfos(db, scope)),
    progress: progress(ctx),
    unfulfilled: { total, open, inProgress },
    unfulfilledAge: unfulfilledAge(ctx),
    breakdown: breakdown(ctx),
    backlogTotal: metric(ctx, "Backlog orders", "backlog", ""),
    ranks: {
      channels: ranks(ctx, sql`channel`, "channel", "enum"),
      clients: clientRanks(ctx),
      carriers: ranks(ctx, sql`NULLIF(carrier, '')`, "carrier", "enum"),
      countries: ranks(ctx, sql`NULLIF(ship_country, '')`, "shipCountry", "text"),
      carriersShipped: ranks(ctx, sql`NULLIF(carrier, '')`, "carrier", "enum", "shipped", carrierShippedQs(days)),
    },
    snapshotGaps: snapshotGaps(db, auth, scope, days),
    jobs: jobs(ctx),
  };
}
