/**
 * Channel Logs repository (M12, spec 06 §8–§11): channel methods (next run, manual Run),
 * channel history (runs with the per-run item detail), and the two call-log grids.
 * Every read is limited to store connections of clients in scope.
 */
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasClient } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { pauseReason, runChannelMethod, type RunSummary } from "@/server/integrations/runtime/channel-runtime";
import {
  HISTORY_FIELDS, HISTORY_SORT_FIELDS, ITEM_SORT_FIELDS, METHOD_FIELDS, METHOD_SORT_FIELDS, ORDER_ITEM_FIELDS, PRODUCT_ITEM_FIELDS,
} from "@/lib/grid-defs/integrations/logs";
import { assertFound, compileGrid, type GridBinding } from "./integration-logs-kit";

const cc = s.channelConnections;
const m = s.channelMethods;
const r = s.channelRuns;
const it = s.channelRunItems;

export function connectionScope(auth: AuthContext, column: SQL = sql`${cc.clientId}`): SQL | undefined {
  const cl = auth.viewScope.clientIds;
  if (cl === "all") return undefined;
  return cl.length === 0 ? sql`0 = 1` : sql`${column} IN (${sql.join(cl.map((x) => sql`${x}`), sql`, `)})`;
}

/* ---------------- methods ---------------- */

const METHOD_BINDING: GridBinding = {
  exprs: {
    provider: sql`${cc.provider}`, method: sql`${m.method}`, jobStatus: sql`${m.jobStatus}`, status: sql`${m.status}`, storeName: sql`${cc.storeName}`,
    nextRunAt: sql`${m.nextRunAt}`, lastRunAt: sql`${m.lastRunAt}`, intervalMinutes: sql`${m.intervalMinutes}`,
  },
  fields: METHOD_FIELDS, sortable: METHOD_SORT_FIELDS, search: ["storeName"], defaultSort: [{ field: "storeName", dir: "asc" }, { field: "method", dir: "asc" }], tiebreaker: m.id,
};

export interface MethodRow {
  readonly id: string;
  readonly connectionId: string;
  readonly method: string;
  readonly storeName: string;
  readonly provider: string;
  readonly isSandbox: boolean;
  readonly status: "Active" | "Passive";
  readonly jobStatus: string;
  readonly intervalMinutes: number;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly pauseReason: string | null;
  readonly lastRunStatus: string | null;
}

export function listMethods(db: AppDb, auth: AuthContext, query: GridQuery): { rows: MethodRow[]; total: number } {
  const grid = compileGrid(METHOD_BINDING, query, [connectionScope(auth)]);
  const lastStatus = sql<string | null>`(SELECT x.status FROM channel_runs x WHERE x.method_id = ${m.id} ORDER BY x.started_at DESC LIMIT 1)`;
  const result = paginate(db.select({ m, c: cc, last: lastStatus }).from(m).innerJoin(cc, eq(cc.id, m.connectionId)).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(m).innerJoin(cc, eq(cc.id, m.connectionId)).where(grid.where).get()?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  return {
    rows: result.rows.map(({ m: x, c, last }) => ({
      id: x.id, connectionId: c.id, method: x.method, storeName: c.storeName, provider: c.provider, isSandbox: c.distribution === "API", status: x.status, jobStatus: x.jobStatus,
      intervalMinutes: x.intervalMinutes, nextRunAt: x.status === "Active" ? x.nextRunAt : null, lastRunAt: x.lastRunAt, lastSuccessAt: x.lastSuccessAt, pauseReason: pauseReason(c), lastRunStatus: last ?? null,
    })),
    total: result.total,
  };
}

export function loadMethod(db: AppDb, auth: AuthContext, id: string) {
  const row = assertFound(db.select({ m, c: cc }).from(m).innerJoin(cc, eq(cc.id, m.connectionId)).where(eq(m.id, id)).get(), "Channel method");
  if (!hasClient(auth.scope, row.c.clientId)) throw new AppError("NOT_FOUND", "Channel method not found");
  return row;
}

export async function runMethodNow(db: AppDb, auth: AuthContext, id: string): Promise<RunSummary> {
  loadMethod(db, auth, id);
  return runChannelMethod(db, id, { manual: true });
}

/* ---------------- history ---------------- */

const HISTORY_BINDING: GridBinding = {
  exprs: {
    provider: sql`${cc.provider}`, method: sql`${r.method}`, startedAt: sql`${r.startedAt}`, storeName: sql`${cc.storeName}`, status: sql`${r.status}`,
    successCount: sql`${r.successCount}`, errorCount: sql`${r.errorCount}`, totalCount: sql`${r.totalCount}`,
  },
  fields: HISTORY_FIELDS, sortable: HISTORY_SORT_FIELDS, search: ["storeName"], defaultSort: [{ field: "startedAt", dir: "desc" }], tiebreaker: r.id,
};

export interface RunRow {
  readonly id: string;
  readonly storeName: string;
  readonly provider: string;
  readonly isSandbox: boolean;
  readonly method: string;
  readonly status: string;
  readonly successCount: number;
  readonly errorCount: number;
  readonly totalCount: number;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

const toRunRow = ({ r: x, c }: { r: typeof r.$inferSelect; c: typeof cc.$inferSelect }): RunRow => ({
  id: x.id, storeName: c.storeName, provider: c.provider, isSandbox: c.distribution === "API", method: x.method, status: x.status, successCount: x.successCount,
  errorCount: x.errorCount, totalCount: x.totalCount, startedAt: x.startedAt, endedAt: x.endedAt,
});

export function listHistory(db: AppDb, auth: AuthContext, query: GridQuery, connectionId?: string | null): { rows: RunRow[]; total: number } {
  const grid = compileGrid(HISTORY_BINDING, query, [connectionScope(auth), connectionId ? eq(r.connectionId, connectionId) : undefined]);
  const result = paginate(db.select({ r, c: cc }).from(r).innerJoin(cc, eq(cc.id, r.connectionId)).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(r).innerJoin(cc, eq(cc.id, r.connectionId)).where(grid.where).get()?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  return { rows: result.rows.map(toRunRow), total: result.total };
}

export interface RunItemRow {
  readonly id: string;
  readonly success: boolean;
  readonly properties: string;
  readonly errorMessage: string | null;
  readonly storeOrderNumber: string | null;
  readonly sellerSku: string | null;
  readonly qty: number | null;
  readonly at: string;
  readonly orderId: string | null;
}

export function getRun(db: AppDb, auth: AuthContext, id: string, page: number, pageSize: number, onlyErrors: boolean): { run: RunRow; items: RunItemRow[]; total: number } {
  const row = assertFound(db.select({ r, c: cc }).from(r).innerJoin(cc, eq(cc.id, r.connectionId)).where(eq(r.id, id)).get(), "Channel run");
  if (!hasClient(auth.scope, row.c.clientId)) throw new AppError("NOT_FOUND", "Channel run not found");
  const where = and(eq(it.runId, id), onlyErrors ? eq(it.success, false) : undefined);
  const total = db.select({ n: sql<number>`count(*)` }).from(it).where(where).get()?.n ?? 0;
  const orderIdSql = sql<string | null>`(SELECT o.id FROM shipment_orders o WHERE o.code = json_extract(${it.properties}, '$.orderCode') LIMIT 1)`;
  const items = db.select({ i: it, orderId: orderIdSql }).from(it).where(where).orderBy(desc(it.success), it.at).limit(pageSize).offset((page - 1) * pageSize).all();
  return {
    run: toRunRow(row), total: Number(total),
    items: items.map(({ i, orderId }) => ({ id: i.id, success: i.success, properties: i.properties, errorMessage: i.errorMessage, storeOrderNumber: i.storeOrderNumber, sellerSku: i.sellerSku, qty: i.qty, at: i.at, orderId: orderId ?? null })),
  };
}

/* ---------------- call logs ---------------- */

export type ItemKind = "orders" | "products";
const KIND_METHODS: Readonly<Record<ItemKind, readonly string[]>> = { orders: ["Download Orders", "Send Shipment Info"], products: ["Download Products", "Sync Inventory"] };

function itemBinding(kind: ItemKind): GridBinding {
  return {
    exprs: {
      at: sql`${it.at}`, provider: sql`${cc.provider}`, storeName: sql`${cc.storeName}`, success: sql`${it.success}`, method: sql`${r.method}`,
      storeOrderNumber: sql`${it.storeOrderNumber}`, sellerSku: sql`${it.sellerSku}`, qty: sql`${it.qty}`,
    },
    fields: kind === "orders" ? ORDER_ITEM_FIELDS : PRODUCT_ITEM_FIELDS, sortable: ITEM_SORT_FIELDS,
    search: kind === "orders" ? ["storeOrderNumber", "storeName"] : ["sellerSku", "storeName"], defaultSort: [{ field: "at", dir: "desc" }], tiebreaker: it.id,
  };
}

export interface CallLogRow {
  readonly id: string;
  readonly provider: string;
  readonly isSandbox: boolean;
  readonly storeName: string;
  readonly method: string;
  readonly at: string;
  readonly storeOrderNumber: string | null;
  readonly sellerSku: string | null;
  readonly qty: number | null;
  readonly errorMessage: string | null;
  readonly success: boolean;
  readonly runId: string;
}

export function listCallLogs(db: AppDb, auth: AuthContext, kind: ItemKind, query: GridQuery): { rows: CallLogRow[]; total: number } {
  const grid = compileGrid(itemBinding(kind), query, [connectionScope(auth), inArray(r.method, [...KIND_METHODS[kind]])]);
  const base = () => db.select({ i: it, r, c: cc }).from(it).innerJoin(r, eq(r.id, it.runId)).innerJoin(cc, eq(cc.id, r.connectionId));
  const result = paginate(base().where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(it).innerJoin(r, eq(r.id, it.runId)).innerJoin(cc, eq(cc.id, r.connectionId)).where(grid.where).get()?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  return {
    rows: result.rows.map(({ i, r: run, c }) => ({
      id: i.id, provider: c.provider, isSandbox: c.distribution === "API", storeName: c.storeName, method: run.method, at: i.at, storeOrderNumber: i.storeOrderNumber,
      sellerSku: i.sellerSku, qty: i.qty, errorMessage: i.errorMessage, success: i.success, runId: run.id,
    })),
    total: result.total,
  };
}
