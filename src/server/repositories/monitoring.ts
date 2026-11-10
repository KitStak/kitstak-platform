/**
 * Channel Monitoring repository (M12, spec 06 §12–§16b): Health Overview (24h success rate,
 * orders/lines, low-performing setups), Setup Details dashboard, Missing Shipment Orders
 * (+ error catalog, Retry Download), Recent Errors (grouped, with drilldown), Workflow Blocked
 * (+ Release) and Product Listing Exceptions. All scoped to clients in the viewer's scope.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { integrationError, type IntegrationErrorInfo } from "@/lib/integration-errors";
import { applyLocalGridQuery, type FieldValue } from "@/lib/local-grid-query";
import { LOW_PERFORMING_PCT, MISSING_FIELDS, MISSING_SORT_FIELDS } from "@/lib/grid-defs/integrations/monitoring";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasClient, hasWarehouse } from "@/server/auth/scope";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import { recordUpdate } from "@/server/domain/change-log";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { retryMissingOrders } from "@/server/integrations/runtime/channel-runtime";
import { assertFound, compileGrid, domainCtxOf, type Actor, type GridBinding } from "./integration-logs-kit";
import { connectionScope } from "./integration-logs";

const cc = s.channelConnections;
const DAY = 86_400_000;

function connections(db: AppDb, auth: AuthContext) {
  return db.select({ c: cc, clientName: s.clients.name }).from(cc).innerJoin(s.clients, eq(s.clients.id, cc.clientId)).where(connectionScope(auth)).all();
}

const local = <T,>(rows: readonly T[], query: GridQuery, search: readonly string[]) =>
  applyLocalGridQuery(rows, query, { get: (row, f) => (row as Record<string, FieldValue>)[f], searchFields: search });

/* ---------------- health ---------------- */

export interface HealthRow {
  readonly id: string;
  readonly provider: string;
  readonly isSandbox: boolean;
  readonly storeName: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly downloadStatus: "Active" | "Passive";
  readonly successRate: number;
  readonly successes24h: number;
  readonly errors24h: number;
  readonly orders24h: number;
  readonly lines24h: number;
  readonly lastSuccessAt: string | null;
}

export function healthRows(db: AppDb, auth: AuthContext, now = new Date()): HealthRow[] {
  const since = new Date(now.getTime() - DAY).toISOString();
  const conns = connections(db, auth);
  if (conns.length === 0) return [];
  const ids = conns.map((x) => x.c.id);
  const methods = db.select().from(s.channelMethods).where(and(inArray(s.channelMethods.connectionId, ids), eq(s.channelMethods.method, "Download Orders"))).all();
  const items = db.all<{ cid: string; ok: number; bad: number }>(sql`
    SELECT r.connection_id AS cid, SUM(CASE WHEN i.success = 1 THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN i.success = 0 THEN 1 ELSE 0 END) AS bad
    FROM channel_run_items i JOIN channel_runs r ON r.id = i.run_id
    WHERE r.method = 'Download Orders' AND i.at >= ${since} GROUP BY r.connection_id`);
  const orders = db.all<{ cid: string; n: number; lines: number }>(sql`
    SELECT o.channel_connection_id AS cid, COUNT(DISTINCT o.id) AS n, COUNT(l.id) AS lines FROM shipment_orders o LEFT JOIN order_lines l ON l.order_id = o.id
    WHERE o.channel_connection_id IS NOT NULL AND o.created_at >= ${since} GROUP BY o.channel_connection_id`);
  return conns.map(({ c, clientName }) => {
    const it = items.find((x) => x.cid === c.id);
    const ok = Number(it?.ok ?? 0);
    const bad = Number(it?.bad ?? 0);
    const o = orders.find((x) => x.cid === c.id);
    const m = methods.find((x) => x.connectionId === c.id);
    return {
      id: c.id, provider: c.provider, isSandbox: c.distribution === "API", storeName: c.storeName, clientId: c.clientId, clientName,
      downloadStatus: m?.status ?? "Passive", successRate: ok + bad === 0 ? 0 : Math.round((ok / (ok + bad)) * 100), successes24h: ok, errors24h: bad,
      orders24h: Number(o?.n ?? 0), lines24h: Number(o?.lines ?? 0), lastSuccessAt: m?.lastSuccessAt ?? null,
    };
  });
}

export function listHealth(db: AppDb, auth: AuthContext, query: GridQuery) {
  return local(healthRows(db, auth), query, ["storeName", "clientName"]);
}

export interface HealthCard { readonly provider: string | null; readonly setups: number; readonly avgSuccess: number; readonly lowPerforming: number }

export function healthCards(db: AppDb, auth: AuthContext, clientId: string | null): HealthCard[] {
  const rows = healthRows(db, auth).filter((r) => !clientId || r.clientId === clientId);
  const card = (provider: string | null, list: readonly HealthRow[]): HealthCard => ({
    provider, setups: list.length, avgSuccess: list.length === 0 ? 0 : Math.round(list.reduce((sum, r) => sum + r.successRate, 0) / list.length),
    lowPerforming: list.filter((r) => r.successRate < LOW_PERFORMING_PCT).length,
  });
  const providers = [...new Set(rows.map((r) => r.provider))].sort();
  return [card(null, rows), ...providers.map((p) => card(p, rows.filter((r) => r.provider === p)))];
}

/* ---------------- missing orders ---------------- */

const mo = s.channelMissingOrders;
const MISSING_BINDING: GridBinding = {
  exprs: {
    orderCode: sql`${mo.orderCode}`, channelOrderNumber: sql`${mo.channelOrderNumber}`, storeName: sql`${cc.storeName}`, provider: sql`${cc.provider}`,
    connectionId: sql`${mo.connectionId}`, clientId: sql`${cc.clientId}`, clientName: sql`(SELECT c2.name FROM clients c2 WHERE c2.id = ${cc.clientId})`,
    orderDate: sql`${mo.orderDate}`, lastUpdated: sql`${mo.lastUpdated}`, lastErrorCode: sql`${mo.lastErrorCode}`, status: sql`${mo.status}`,
  },
  fields: MISSING_FIELDS, sortable: MISSING_SORT_FIELDS, search: ["orderCode", "channelOrderNumber"], defaultSort: [{ field: "lastUpdated", dir: "desc" }], tiebreaker: mo.id,
};

export interface MissingRow {
  readonly id: string;
  readonly orderCode: string;
  readonly channelOrderNumber: string;
  readonly connectionId: string;
  readonly storeName: string;
  readonly provider: string;
  readonly isSandbox: boolean;
  readonly clientName: string;
  readonly orderDate: string;
  readonly lastUpdated: string;
  readonly lastErrorCode: string;
  readonly status: string;
}

export function listMissing(db: AppDb, auth: AuthContext, query: GridQuery): { rows: MissingRow[]; total: number } {
  const statusFiltered = query.filters.some((f) => f.field === "status");
  const grid = compileGrid(MISSING_BINDING, query, [connectionScope(auth), statusFiltered ? undefined : sql`${mo.status} <> 'Resolved'`]);
  const result = paginate(db.select({ m: mo, c: cc, clientName: s.clients.name }).from(mo).innerJoin(cc, eq(cc.id, mo.connectionId)).innerJoin(s.clients, eq(s.clients.id, cc.clientId)).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(mo).innerJoin(cc, eq(cc.id, mo.connectionId)).where(grid.where).get()?.n ?? 0, { page: query.page, pageSize: query.pageSize });
  return {
    rows: result.rows.map(({ m, c, clientName }) => ({
      id: m.id, orderCode: m.orderCode, channelOrderNumber: m.channelOrderNumber, connectionId: c.id, storeName: c.storeName, provider: c.provider, isSandbox: c.distribution === "API",
      clientName, orderDate: m.orderDate, lastUpdated: m.lastUpdated, lastErrorCode: m.lastErrorCode, status: m.status,
    })),
    total: result.total,
  };
}

export interface MissingDetail extends MissingRow { readonly payload: string; readonly error: IntegrationErrorInfo; readonly history: readonly { readonly at: string; readonly message: string | null; readonly success: boolean }[] }

export function getMissing(db: AppDb, auth: AuthContext, id: string): MissingDetail {
  const row = assertFound(db.select({ m: mo, c: cc, clientName: s.clients.name }).from(mo).innerJoin(cc, eq(cc.id, mo.connectionId)).innerJoin(s.clients, eq(s.clients.id, cc.clientId)).where(eq(mo.id, id)).get(), "Missing order");
  if (!hasClient(auth.scope, row.c.clientId)) throw new AppError("NOT_FOUND", "Missing order not found");
  const history = db.select({ at: s.channelRunItems.at, message: s.channelRunItems.errorMessage, success: s.channelRunItems.success }).from(s.channelRunItems)
    .innerJoin(s.channelRuns, eq(s.channelRuns.id, s.channelRunItems.runId))
    .where(and(eq(s.channelRuns.connectionId, row.c.id), eq(s.channelRunItems.storeOrderNumber, row.m.channelOrderNumber))).orderBy(desc(s.channelRunItems.at)).limit(10).all();
  return {
    id: row.m.id, orderCode: row.m.orderCode, channelOrderNumber: row.m.channelOrderNumber, connectionId: row.c.id, storeName: row.c.storeName, provider: row.c.provider,
    isSandbox: row.c.distribution === "API", clientName: row.clientName, orderDate: row.m.orderDate, lastUpdated: row.m.lastUpdated, lastErrorCode: row.m.lastErrorCode, status: row.m.status,
    payload: row.m.payload, error: integrationError(row.m.lastErrorCode), history,
  };
}

export async function retryMissing(db: AppDb, auth: AuthContext, ids: readonly string[]): Promise<BulkResult> {
  const rows = db.select({ id: mo.id, clientId: cc.clientId, status: mo.status }).from(mo).innerJoin(cc, eq(cc.id, mo.connectionId)).where(inArray(mo.id, [...ids])).all();
  const allowed = rows.filter((r) => hasClient(auth.scope, r.clientId) && r.status !== "Resolved").map((r) => r.id);
  const rejected = ids.filter((id) => !allowed.includes(id)).map((id) => ({ id, code: "INVALID_STATE", message: rows.some((r) => r.id === id && r.status === "Resolved") ? "Already downloaded" : "Missing order not found" }));
  const res = allowed.length > 0 ? await retryMissingOrders(db, allowed) : { succeeded: [], failed: [] };
  return { succeeded: res.succeeded, failed: [...res.failed, ...rejected] };
}

/* ---------------- recent errors ---------------- */

export interface RecentErrorRow {
  readonly id: string;
  readonly errorReason: string;
  readonly connectionId: string;
  readonly storeName: string;
  readonly provider: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly occurrences: number;
  readonly affectedOrders: number;
  readonly lastOccurrence: string;
  readonly day: string;
}

export function recentErrorRows(db: AppDb, auth: AuthContext, now = new Date()): RecentErrorRow[] {
  const since = new Date(now.getTime() - 14 * DAY).toISOString();
  const conns = new Map(connections(db, auth).map((x) => [x.c.id, x]));
  if (conns.size === 0) return [];
  const rows = db.all<{ cid: string; msg: string; day: string; n: number; orders: number; last: string }>(sql`
    SELECT r.connection_id AS cid, i.error_message AS msg, substr(i.at, 1, 10) AS day, COUNT(*) AS n, COUNT(DISTINCT i.store_order_number) AS orders, MAX(i.at) AS last
    FROM channel_run_items i JOIN channel_runs r ON r.id = i.run_id
    WHERE i.success = 0 AND r.method = 'Download Orders' AND i.at >= ${since} GROUP BY r.connection_id, i.error_message, substr(i.at, 1, 10)`);
  const grouped = new Map<string, RecentErrorRow>();
  for (const x of rows) {
    const conn = conns.get(x.cid);
    if (!conn) continue;
    const reason = (x.msg ?? "Unexpected Error").split(":")[0]?.trim() || "Unexpected Error";
    const key = `${x.cid}|${reason}|${x.day}`;
    const prev = grouped.get(key);
    grouped.set(key, {
      id: key, errorReason: reason, connectionId: x.cid, storeName: conn.c.storeName, provider: conn.c.provider, clientId: conn.c.clientId, clientName: conn.clientName,
      occurrences: (prev?.occurrences ?? 0) + Number(x.n), affectedOrders: (prev?.affectedOrders ?? 0) + Number(x.orders), lastOccurrence: prev && prev.lastOccurrence > x.last ? prev.lastOccurrence : x.last, day: x.day,
    });
  }
  return [...grouped.values()].sort((a, b) => b.lastOccurrence.localeCompare(a.lastOccurrence));
}

export function listRecentErrors(db: AppDb, auth: AuthContext, query: GridQuery) {
  return local(recentErrorRows(db, auth), { ...query, sort: query.sort.length > 0 ? query.sort : [{ field: "lastOccurrence", dir: "desc" }] }, ["errorReason", "storeName"]);
}

/** Drilldown: the orders affected by one grouped error (beyond Logiwa). */
export function recentErrorOrders(db: AppDb, auth: AuthContext, connectionId: string, reason: string, day: string) {
  const conn = assertFound(db.select().from(cc).where(eq(cc.id, connectionId)).get(), "Store connection");
  if (!hasClient(auth.scope, conn.clientId)) throw new AppError("NOT_FOUND", "Store connection not found");
  const items = db.select({ i: s.channelRunItems }).from(s.channelRunItems).innerJoin(s.channelRuns, eq(s.channelRuns.id, s.channelRunItems.runId))
    .where(and(eq(s.channelRuns.connectionId, connectionId), eq(s.channelRunItems.success, false), sql`${s.channelRunItems.errorMessage} LIKE ${`${reason}%`}`, sql`substr(${s.channelRunItems.at}, 1, 10) = ${day}`))
    .orderBy(desc(s.channelRunItems.at)).limit(200).all();
  const numbers = [...new Set(items.map((x) => x.i.storeOrderNumber).filter((v): v is string => Boolean(v)))];
  const missing = numbers.length === 0 ? [] : db.select().from(mo).where(and(eq(mo.connectionId, connectionId), inArray(mo.channelOrderNumber, numbers))).all();
  return numbers.map((n) => {
    const m = missing.find((x) => x.channelOrderNumber === n);
    const last = items.find((x) => x.i.storeOrderNumber === n);
    return { storeOrderNumber: n, missingOrderId: m?.id ?? null, orderCode: m?.orderCode ?? null, status: m?.status ?? "Error", lastErrorCode: m?.lastErrorCode ?? reason, message: last?.i.errorMessage ?? null, at: last?.i.at ?? "" };
  });
}

/* ---------------- workflow blocked ---------------- */

export interface BlockedRow {
  readonly id: string;
  readonly orderCode: string;
  readonly blockType: string;
  readonly storeName: string | null;
  readonly provider: string | null;
  readonly clientId: string;
  readonly clientName: string;
  readonly orderDate: string;
  readonly workflowId: string | null;
  readonly workflowName: string | null;
  readonly actionName: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly status: string;
  readonly blockedAt: string | null;
}

export function blockedRows(db: AppDb, auth: AuthContext): BlockedRow[] {
  const o = s.shipmentOrders;
  const wh = auth.viewScope.warehouseIds;
  if (wh.length === 0) return [];
  const orders = db.select({ o, clientName: s.clients.name, whCode: s.warehouses.code, store: cc.storeName, provider: cc.provider }).from(o)
    .innerJoin(s.clients, eq(s.clients.id, o.clientId)).innerJoin(s.warehouses, eq(s.warehouses.id, o.warehouseId)).leftJoin(cc, eq(cc.id, o.channelConnectionId))
    .where(and(sql`${o.workflowBlocked} <> 'None'`, sql`${o.deletedAt} IS NULL`, inArray(o.warehouseId, [...wh]), connectionScope(auth, sql`${o.clientId}`))).all();
  if (orders.length === 0) return [];
  const runs = db.select({ r: s.workflowRuns, name: s.workflows.name }).from(s.workflowRuns).leftJoin(s.workflows, eq(s.workflows.id, s.workflowRuns.workflowId))
    .where(and(inArray(s.workflowRuns.entityId, orders.map((x) => x.o.id)), sql`${s.workflowRuns.blockType} IS NOT NULL`)).orderBy(desc(s.workflowRuns.at)).all();
  return orders.map(({ o: x, clientName, whCode, store, provider }) => {
    const run = runs.find((r) => r.r.entityId === x.id);
    return {
      id: x.id, orderCode: x.code, blockType: x.workflowBlocked, storeName: store ?? x.storeName, provider: provider ?? null, clientId: x.clientId, clientName, orderDate: x.orderDate,
      workflowId: run?.r.workflowId ?? null, workflowName: run?.name ?? null, actionName: x.workflowBlocked === "Fully" ? "Block Order" : "Partially Block Order",
      warehouseId: x.warehouseId, warehouseCode: whCode, status: x.status, blockedAt: run?.r.at ?? null,
    };
  });
}

export function listBlocked(db: AppDb, auth: AuthContext, query: GridQuery) {
  return local(blockedRows(db, auth), { ...query, sort: query.sort.length > 0 ? query.sort : [{ field: "orderDate", dir: "desc" }] }, ["orderCode", "storeName", "workflowName"]);
}

export function releaseBlocked(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  const o = s.shipmentOrders;
  return runBulk(tx, ids, (inner, id) => {
    const order = inner.select().from(o).where(eq(o.id, id)).get();
    if (!order || !hasWarehouse(auth.scope, order.warehouseId) || !hasClient(auth.scope, order.clientId)) throw new AppError("NOT_FOUND", "Shipment order not found");
    if (order.workflowBlocked === "None") throw new AppError("INVALID_STATE", `Order ${order.code} is not blocked by a workflow`);
    inner.update(o).set({ workflowBlocked: "None", updatedBy: actor.userId, version: sql`${o.version} + 1` }).where(eq(o.id, id)).run();
    recordUpdate(inner, ctx, { entityType: "shipment_order", entityId: id, entityCode: order.code, before: { workflowBlocked: order.workflowBlocked }, after: { workflowBlocked: "None" } });
  });
}

/* ---------------- listing exceptions ---------------- */

export interface ListingExceptionRow {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly sellerSkus: string;
  readonly channelProductIds: string;
  readonly connectionId: string;
  readonly storeName: string;
  readonly provider: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly issueType: "Multi Listing" | "SKU Difference";
  readonly listingDate: string;
}

export function listingExceptionRows(db: AppDb, auth: AuthContext): ListingExceptionRow[] {
  const l = s.productListings;
  const rows = db.select({ l, sku: s.products.sku, c: cc, clientName: s.clients.name }).from(l).innerJoin(s.products, eq(s.products.id, l.productId))
    .innerJoin(cc, eq(cc.id, l.channelConnectionId)).innerJoin(s.clients, eq(s.clients.id, cc.clientId)).where(connectionScope(auth)).all();
  const out: ListingExceptionRow[] = [];
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(`${r.c.id}|${r.l.productId}`, [...(groups.get(`${r.c.id}|${r.l.productId}`) ?? []), r]);
  for (const [key, list] of groups) {
    const first = list[0];
    if (!first) continue;
    const base = { productId: first.l.productId as string, sku: first.sku, connectionId: first.c.id, storeName: first.c.storeName, provider: first.c.provider, clientId: first.c.clientId, clientName: first.clientName };
    if (list.length > 1) {
      out.push({ ...base, id: `${key}|multi`, sellerSkus: list.map((x) => x.l.sellerSku).join(", "), channelProductIds: list.map((x) => x.l.channelProductId).join(", "), issueType: "Multi Listing", listingDate: list.map((x) => x.l.createdAt).sort().at(-1) ?? first.l.createdAt });
    }
    for (const x of list) {
      if (x.l.sellerSku.trim().toLowerCase() !== x.sku.trim().toLowerCase()) {
        out.push({ ...base, id: `${x.l.id}|diff`, sellerSkus: x.l.sellerSku, channelProductIds: x.l.channelProductId, issueType: "SKU Difference", listingDate: x.l.createdAt });
      }
    }
  }
  return out;
}

export function listListingExceptions(db: AppDb, auth: AuthContext, query: GridQuery) {
  return local(listingExceptionRows(db, auth), { ...query, sort: query.sort.length > 0 ? query.sort : [{ field: "listingDate", dir: "desc" }] }, ["sku", "sellerSkus"]);
}

/* ---------------- setup details ---------------- */

export interface SetupDetails {
  readonly id: string;
  readonly storeName: string;
  readonly provider: string;
  readonly isSandbox: boolean;
  readonly clientName: string;
  readonly warehouses: readonly string[];
  readonly successRate: number;
  readonly successes24h: number;
  readonly errors24h: number;
  readonly volume: readonly { readonly day: string; readonly channel: number; readonly kitstaks: number }[];
  readonly missing: readonly MissingRow[];
  readonly blocked: readonly BlockedRow[];
  readonly listingExceptions: readonly ListingExceptionRow[];
  readonly recentErrors: readonly RecentErrorRow[];
  readonly counts: { readonly missing: number; readonly blocked: number; readonly listingExceptions: number; readonly recentErrors: number };
}

export function setupDetails(db: AppDb, auth: AuthContext, id: string, now = new Date()): SetupDetails {
  const conn = assertFound(db.select({ c: cc, clientName: s.clients.name }).from(cc).innerJoin(s.clients, eq(s.clients.id, cc.clientId)).where(eq(cc.id, id)).get(), "Store connection");
  if (!hasClient(auth.scope, conn.c.clientId)) throw new AppError("NOT_FOUND", "Store connection not found");
  const health = healthRows(db, auth, now).find((h) => h.id === id);
  const since = new Date(now.getTime() - 13 * DAY).toISOString().slice(0, 10);
  const channelDays = db.all<{ day: string; n: number }>(sql`
    SELECT substr(i.at, 1, 10) AS day, COUNT(DISTINCT i.store_order_number) AS n FROM channel_run_items i JOIN channel_runs r ON r.id = i.run_id
    WHERE r.connection_id = ${id} AND r.method = 'Download Orders' AND substr(i.at, 1, 10) >= ${since} GROUP BY day`);
  const ksDays = db.all<{ day: string; n: number }>(sql`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM shipment_orders WHERE channel_connection_id = ${id} AND substr(created_at, 1, 10) >= ${since} GROUP BY day`);
  const volume = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(now.getTime() - (13 - i) * DAY).toISOString().slice(0, 10);
    return { day, channel: Number(channelDays.find((d) => d.day === day)?.n ?? 0), kitstaks: Number(ksDays.find((d) => d.day === day)?.n ?? 0) };
  });
  const missingAll = db.select({ m: mo }).from(mo).where(and(eq(mo.connectionId, id), sql`${mo.status} <> 'Resolved'`)).orderBy(desc(mo.lastUpdated)).all();
  const blocked = blockedRows(db, auth).filter((b) => b.storeName === conn.c.storeName);
  const exceptions = listingExceptionRows(db, auth).filter((e) => e.connectionId === id);
  const errors = recentErrorRows(db, auth, now).filter((e) => e.connectionId === id);
  const wh = db.select({ code: s.warehouses.code }).from(s.channelLocationMappings).innerJoin(s.warehouses, eq(s.warehouses.id, s.channelLocationMappings.warehouseId)).where(eq(s.channelLocationMappings.connectionId, id)).all();
  return {
    id, storeName: conn.c.storeName, provider: conn.c.provider, isSandbox: conn.c.distribution === "API", clientName: conn.clientName, warehouses: [...new Set(wh.map((w) => w.code))],
    successRate: health?.successRate ?? 0, successes24h: health?.successes24h ?? 0, errors24h: health?.errors24h ?? 0, volume,
    missing: missingAll.slice(0, 5).map(({ m }) => ({ id: m.id, orderCode: m.orderCode, channelOrderNumber: m.channelOrderNumber, connectionId: id, storeName: conn.c.storeName, provider: conn.c.provider, isSandbox: conn.c.distribution === "API", clientName: conn.clientName, orderDate: m.orderDate, lastUpdated: m.lastUpdated, lastErrorCode: m.lastErrorCode, status: m.status })),
    blocked: blocked.slice(0, 5), listingExceptions: exceptions.slice(0, 5), recentErrors: errors.slice(0, 5),
    counts: { missing: missingAll.length, blocked: blocked.length, listingExceptions: exceptions.length, recentErrors: errors.length },
  };
}
