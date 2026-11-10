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
import { TASK_TYPES_BY_KIND } from "@/lib/grid-defs/jobs/tasks";
import { compileOrderGrid } from "./orders-grid";
import { viewCondition } from "./orders";

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
}

export interface RankRow {
  readonly name: string;
  readonly count: number;
  readonly pct: number;
  readonly href: string | null;
}

export interface JobRow {
  readonly name: string;
  readonly productQty: number;
  readonly orderQty: number;
  readonly jobQty: number;
  readonly pct: number;
  readonly href: string;
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
  readonly selection: { readonly warehouseIds: readonly string[]; readonly clientIds: readonly string[] | "all" };
  readonly shift: ShiftInfo | null;
  readonly progress: { readonly tasks: Progress; readonly lines: Progress; readonly ordersToday: Progress };
  readonly unfulfilled: { readonly total: Metric; readonly open: Metric; readonly inProgress: Metric };
  readonly breakdown: readonly (readonly Metric[])[];
  readonly ranks: { readonly channels: readonly RankRow[]; readonly clients: readonly RankRow[]; readonly carriers: readonly RankRow[]; readonly countries: readonly RankRow[] };
  readonly jobs: { readonly priority: readonly JobRow[]; readonly status: readonly JobRow[]; readonly type: readonly JobRow[] };
}

export const IN_PROGRESS_STATUSES = ["Ready to Pick", "Picking Started", "Ready to Pack", "Packing Started", "Ready to Sort", "Sorting Started", "Ready to Load", "Loading Started", "Ready to Ship"] as const;
const PACKED_STATUSES = ["Ready to Load", "Loading Started", "Ready to Ship"] as const;
const SHIPPED_STATUSES = ["Shipped", "Partially Shipped", "Delivered"] as const;
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
}

function orderWhere(ctx: Ctx, view: "backlog" | "shipped", filters: readonly GridFilter[]): SQL {
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

function breakdown(ctx: Ctx): Metric[][] {
  const s = (label: string, status: string) => metric(ctx, label, "backlog", inStatuses([status]));
  return [
    [s("Open", "Open"), s("Ready to Pick", "Ready to Pick"), s("Picking Started", "Picking Started")],
    [s("Ready to Pack", "Ready to Pack"), s("Packing Started", "Packing Started"), s("Ready to Load", "Ready to Load"), s("Ready to Ship", "Ready to Ship")],
    [
      metric(ctx, "Cancelled Today", "shipped", `${inStatuses(["Cancelled"])}&f.cancelledAt=date:today`),
      s("Shortage", "Shortage"),
      s("On Hold", "On Hold"),
    ],
    [
      metric(ctx, "Already Shipped Today", "shipped", `${inStatuses(SHIPPED_STATUSES)}&f.shippedAt=date:today`),
      metric(ctx, "Orders to be Shipped Today", "backlog", "f.expectedShipDate=date:before0d"),
      metric(ctx, "Orders to be Shipped Tomorrow", "backlog", `f.expectedShipDate=date:custom:${tomorrow()}..${tomorrow()}`),
    ],
  ];
}

function tomorrow(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return d.toISOString().slice(0, 10);
}

const todayStart = (now: Date = new Date()): string => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

function ranks(ctx: Ctx, expr: SQL, field: string, kind: "enum" | "text"): RankRow[] {
  const where = orderWhere(ctx, "backlog", ctx.base);
  const rows = ctx.db.all<{ name: string | null; n: number }>(sql`SELECT ${expr} AS name, COUNT(*) AS n FROM shipment_orders WHERE ${where} GROUP BY 1 ORDER BY n DESC, name`);
  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 10000) / 100 : 0);
  const link = (name: string | null): string => {
    const f: GridFilter = name === null || name === ""
      ? { field, op: "empty" }
      : kind === "enum" ? { field, op: "in", values: [name] } : { field, op: "eq", value: name };
    return orderHref("backlog", [...ctx.base, f]);
  };
  const top = rows.slice(0, RANK_LIMIT).map((r) => ({ name: r.name ?? "Not set", count: Number(r.n), pct: pct(Number(r.n)), href: link(r.name) }));
  const rest = rows.slice(RANK_LIMIT).reduce((a, r) => a + Number(r.n), 0);
  return rest > 0 ? [...top, { name: "Others", count: rest, pct: pct(rest), href: null }] : top;
}

function clientRanks(ctx: Ctx): RankRow[] {
  const where = orderWhere(ctx, "backlog", ctx.base);
  const rows = ctx.db.all<{ id: string; name: string; n: number }>(sql`SELECT c.id AS id, c.name AS name, COUNT(*) AS n FROM shipment_orders JOIN clients c ON c.id = shipment_orders.client_id WHERE ${where} GROUP BY c.id ORDER BY n DESC, c.name`);
  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 10000) / 100 : 0);
  const base = ctx.base.filter((f) => f.field !== "clientId");
  const top = rows.slice(0, RANK_LIMIT).map((r) => ({ name: r.name, count: Number(r.n), pct: pct(Number(r.n)), href: orderHref("backlog", [...base, { field: "clientId", op: "in", values: [r.id] }]) }));
  const rest = rows.slice(RANK_LIMIT).reduce((a, r) => a + Number(r.n), 0);
  return rest > 0 ? [...top, { name: "Others", count: rest, pct: pct(rest), href: null }] : top;
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
  const t0 = todayStart();
  const types = sql.join(ORDER_TASK_TYPES.map((x) => sql`${x}`), sql`, `);
  const whereTasks = and(
    scopedWhere(schema.tasks, ctx.scope),
    sql`${schema.tasks.taskType} IN (${types})`,
    sql`${schema.tasks.status} <> 'Cancelled' AND (${schema.tasks.status} IN ('Pending', 'Started') OR (${schema.tasks.status} = 'Completed' AND ${schema.tasks.finishedAt} >= ${t0}))`,
  );
  const t = ctx.db.get<{ total: number; done: number }>(sql`SELECT COUNT(*) AS total, COALESCE(SUM(status = 'Completed'), 0) AS done FROM tasks WHERE ${whereTasks}`);

  const backlog = orderWhere(ctx, "backlog", ctx.base);
  const shippedToday = orderWhere(ctx, "shipped", [...ctx.base, ...parseFilters(`${inStatuses(SHIPPED_STATUSES)}&f.shippedAt=date:today`)]);
  const lines = ctx.db.get<{ total: number; done: number }>(sql`
    SELECT COUNT(*) AS total, COALESCE(SUM(l.packed_quantity >= l.quantity - COALESCE(l.cancelled_quantity, 0)), 0) AS done
    FROM order_lines l JOIN shipment_orders ON shipment_orders.id = l.order_id
    WHERE (${backlog}) OR (${shippedToday})`);

  const dueFilters = [...ctx.base, ...parseFilters("f.expectedShipDate=date:before0d")];
  const due = orderWhere(ctx, "backlog", dueFilters);
  const packedStatuses = sql.raw(`(${PACKED_STATUSES.map((s) => `'${s}'`).join(",")})`);
  const dueRow = ctx.db.get<{ total: number; done: number }>(sql`SELECT COUNT(*) AS total, COALESCE(SUM(status IN ${packedStatuses}), 0) AS done FROM shipment_orders WHERE ${due}`);
  const shippedRow = ctx.db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE ${shippedToday}`);
  const shippedN = Number(shippedRow?.n ?? 0);
  const scopeQs = taskScopeQs(ctx);
  const openHref = `${TASKS_GRID}?f.status=in:Pending,Started${scopeQs}`;
  const doneHref = `${TASKS_GRID}?f.status=in:Completed&f.finishedAt=date:today${scopeQs}`;
  return {
    tasks: { done: Number(t?.done ?? 0), total: Number(t?.total ?? 0), href: openHref, openHref, doneHref },
    lines: { done: Number(lines?.done ?? 0), total: Number(lines?.total ?? 0), href: orderHref("backlog", ctx.base) },
    ordersToday: { done: Number(dueRow?.done ?? 0) + shippedN, total: Number(dueRow?.total ?? 0) + shippedN, href: orderHref("backlog", dueFilters) },
  };
}

function warehouseName(ctx: Ctx): string {
  const id = ctx.scope.warehouseIds[0];
  return ctx.db.get<{ name: string }>(sql`SELECT name FROM warehouses WHERE id = ${id ?? ""}`)?.name ?? "";
}

function jobRows(ctx: Ctx, groupExpr: SQL, filterField: string, statusFilter: SQL, statusQs: string, valueOf?: (name: string) => string): JobRow[] {
  const scope = scopedWhere(schema.jobs, ctx.scope);
  const rows = ctx.db.all<{ name: string | null; units: number; orders: number; n: number }>(sql`
    SELECT ${groupExpr} AS name, COALESCE(SUM(unit_count), 0) AS units, COALESCE(SUM(order_count), 0) AS orders, COUNT(*) AS n
    FROM jobs WHERE ${and(scope, statusFilter)} GROUP BY 1 ORDER BY n DESC, name`);
  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  const single = (field: string, value: string | null): string => (value ? `&f.${field}=eq:${encodeURIComponent(value)}` : "");
  const wh = ctx.scope.warehouseIds.length === 1 ? single("warehouse", warehouseName(ctx)) : "";
  const cl = Array.isArray(ctx.scope.clientIds) && ctx.scope.clientIds.length === 1
    ? single("client", ctx.db.get<{ name: string }>(sql`SELECT name FROM clients WHERE id = ${ctx.scope.clientIds[0] ?? ""}`)?.name ?? null)
    : "";
  return rows.map((r) => {
    const name = r.name ?? "None";
    const value = valueOf ? valueOf(name) : `${filterField === "jobType" ? "eq" : "in"}:${encodeURIComponent(name)}`;
    return {
      name,
      productQty: Number(r.units),
      orderQty: Number(r.orders),
      jobQty: Number(r.n),
      pct: total > 0 ? Math.round((Number(r.n) / total) * 1000) / 10 : 0,
      href: `/jobs?${statusQs}&f.${filterField}=${value}${wh}${cl}`.replace("?&", "?"),
    };
  });
}

function jobs(ctx: Ctx): LiveDashboard["jobs"] {
  const t0 = todayStart();
  const open = sql`status IN ('Pending', 'Started', 'In Progress')`;
  const openQs = "f.status=in:Pending,Started";
  const statusRows = jobRows(ctx, sql`status`, "status",
    sql`(status IN ('Pending', 'Started', 'In Progress') OR (status IN ('Completed', 'Cancelled') AND COALESCE(completed_at, updated_at) >= ${t0}))`, "",
    (name) => (name === "Completed" ? "in:Completed&f.completedAt=date:today" : `in:${encodeURIComponent(name)}`));
  return {
    priority: jobRows(ctx, sql`COALESCE(priority, 'None')`, "priority", open, openQs),
    status: statusRows,
    type: jobRows(ctx, sql`job_type`, "jobType", open, openQs),
  };
}

function shiftInfo(db: AppDb, scope: Scope): ShiftInfo | null {
  if (scope.warehouseIds.length !== 1) return null;
  const w = db.get<{ id: string; code: string; name: string; tz: string; s: string; e: string }>(sql`
    SELECT id, code, name, timezone AS tz, day_shift_start AS s, day_shift_end AS e FROM warehouses WHERE id = ${scope.warehouseIds[0] ?? ""}`);
  if (!w) return null;
  return { warehouseId: w.id, warehouseLabel: w.name.startsWith(w.code) ? w.name : `${w.code} - ${w.name}`, timeZone: w.tz, start: w.s, end: w.e };
}

export function getLiveDashboard(db: AppDb, auth: AuthContext, sel: DashboardSelection): LiveDashboard {
  const scope = effectiveScope(auth, sel);
  const ctx: Ctx = { db, scope, base: scopeFilters(scope, sel) };
  const open = metric(ctx, "Open", "backlog", inStatuses(["Open"]));
  const inProgress = metric(ctx, "In Progress", "backlog", inStatuses(IN_PROGRESS_STATUSES));
  const total: Metric = {
    label: "Total",
    count: open.count + inProgress.count,
    packQty: (open.packQty ?? 0) + (inProgress.packQty ?? 0),
    href: orderHref("backlog", [...ctx.base, ...parseFilters(inStatuses(["Open", ...IN_PROGRESS_STATUSES]))]),
  };
  return {
    asOf: new Date().toISOString(),
    selection: { warehouseIds: scope.warehouseIds, clientIds: scope.clientIds },
    shift: shiftInfo(db, scope),
    progress: progress(ctx),
    unfulfilled: { total, open, inProgress },
    breakdown: breakdown(ctx),
    ranks: {
      channels: ranks(ctx, sql`channel`, "channel", "enum"),
      clients: clientRanks(ctx),
      carriers: ranks(ctx, sql`NULLIF(carrier, '')`, "carrier", "enum"),
      countries: ranks(ctx, sql`NULLIF(ship_country, '')`, "shipCountry", "text"),
    },
    jobs: jobs(ctx),
  };
}
