/**
 * Channel Monitoring repository (M12, spec 06 §12–§16b): Health Overview (24h success rate,
 * orders/lines, low-performing setups), Setup Details dashboard, Missing Shipment Orders
 * (+ error catalog, Retry Download), Recent Errors (grouped, with drilldown), Workflow Blocked
 * (+ Release) and Product Listing Exceptions. All scoped to clients in the viewer's scope.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { desc } from '@/server/db/order';
import type { IntegrationErrorInfo } from '@/lib/integration-errors';
import { brandText } from '@/lib/grid-defs/integrations/common';
import { applyLocalGridQuery, type FieldValue } from '@/lib/local-grid-query';
import {
  catalogError,
  healthStatus,
  MISSING_FIELDS,
  MISSING_SORT_FIELDS,
  successRateOf,
  summarizeHealth,
} from '@/lib/grid-defs/integrations/monitoring';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { hasClient, hasWarehouse } from '@/server/auth/scope';
import * as s from '@/server/db/schema';
import { runBulk } from '@/server/domain/bulk';
import { recordUpdate } from '@/server/domain/change-log';
import type { BulkResult } from '@/server/domain/types';
import { paginate } from '@/server/query/paginate';
import type { GridQuery } from '@/server/query/grid-query';
import { pauseReason, retryMissingOrders } from '@/server/integrations/runtime/channel-runtime';
import { assertFound, compileGrid, domainCtxOf, type Actor, type GridBinding } from './integration-logs-kit';
import { connectionScope } from './integration-logs';
import { dayKeyInZone, lastDaysInZone, safeTimeZone } from '@/lib/grid-defs/integrations/time';
import { dbAll } from '@/server/db/sql';

const cc = s.channelConnections;
const DAY = 86_400_000;

/**
 * Time zone used to cut per-day buckets: the viewer's zone (sent by the UI as `tz`), else the
 * context warehouse's zone, else the first warehouse in scope. Matches how timestamps render.
 */
export async function bucketZone(db: AppDb, auth: AuthContext, tz?: string | null): Promise<string> {
  if (tz) return safeTimeZone(tz);
  const whId = auth.context.warehouseId ?? auth.viewScope.warehouseIds[0];
  const row = whId
    ? (
        await db
          .select({ tz: s.warehouses.timezone })
          .from(s.warehouses)
          .where(eq(s.warehouses.id, whId))
          .limit(1)
      )[0]
    : undefined;
  return safeTimeZone(row?.tz);
}

async function connections(db: AppDb, auth: AuthContext) {
  return await db
    .select({ c: cc, clientName: s.clients.name })
    .from(cc)
    .innerJoin(s.clients, eq(s.clients.id, cc.clientId))
    .where(connectionScope(auth));
}

const local = <T>(rows: readonly T[], query: GridQuery, search: readonly string[]) =>
  applyLocalGridQuery(rows, query, {
    get: (row, f) => (row as Record<string, FieldValue>)[f],
    searchFields: search,
  });

/* ---------------- health ---------------- */

export interface HealthRow {
  readonly id: string;
  readonly provider: string;
  readonly isSandbox: boolean;
  readonly storeName: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly downloadStatus: 'Active' | 'Passive' | 'Paused';
  /** Why the scheduler cannot run this setup (missing credentials, no live adapter, inactive). */
  readonly pauseReason: string | null;
  readonly successRate: number | null;
  readonly successes24h: number;
  readonly errors24h: number;
  readonly orders24h: number;
  readonly lines24h: number;
  readonly lastSuccessAt: string | null;
  readonly lastCallAt: string | null;
}

export async function healthRows(db: AppDb, auth: AuthContext, now = new Date()): Promise<HealthRow[]> {
  const since = new Date(now.getTime() - DAY).toISOString();
  const conns = await connections(db, auth);
  if (conns.length === 0) return [];
  const ids = conns.map((x) => x.c.id);
  const methods = await db
    .select()
    .from(s.channelMethods)
    .where(and(inArray(s.channelMethods.connectionId, ids), eq(s.channelMethods.method, 'Download Orders')));
  const items = await dbAll<{ cid: string; ok: number; bad: number }>(
    db,
    sql`
    SELECT r.connection_id AS cid, SUM(CASE WHEN i.success = true THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN i.success = false THEN 1 ELSE 0 END) AS bad
    FROM channel_run_items i JOIN channel_runs r ON r.id = i.run_id
    WHERE r.method = 'Download Orders' AND i.at >= ${since} GROUP BY r.connection_id`,
  );
  const orders = await dbAll<{ cid: string; n: number; lines: number }>(
    db,
    sql`
    SELECT o.channel_connection_id AS cid, COUNT(DISTINCT o.id) AS n, COUNT(l.id) AS lines FROM shipment_orders o LEFT JOIN order_lines l ON l.order_id = o.id
    WHERE o.channel_connection_id IS NOT NULL AND o.created_at >= ${since} GROUP BY o.channel_connection_id`,
  );
  return conns.map(({ c, clientName }) => {
    const it = items.find((x) => x.cid === c.id);
    const ok = Number(it?.ok ?? 0);
    const bad = Number(it?.bad ?? 0);
    const o = orders.find((x) => x.cid === c.id);
    const m = methods.find((x) => x.connectionId === c.id);
    return {
      id: c.id,
      provider: c.provider,
      isSandbox: c.distribution === 'API',
      storeName: c.storeName,
      clientId: c.clientId,
      clientName,
      ...healthStatus(m?.status ?? 'Passive', pauseReason(c)),
      successRate: successRateOf(ok, bad),
      successes24h: ok,
      errors24h: bad,
      orders24h: Number(o?.n ?? 0),
      lines24h: Number(o?.lines ?? 0),
      lastSuccessAt: m?.lastSuccessAt ?? null,
      lastCallAt: m?.lastRunAt ?? null,
    };
  });
}

export async function listHealth(db: AppDb, auth: AuthContext, query: GridQuery) {
  return local(await healthRows(db, auth), query, ['storeName', 'clientName']);
}

export interface HealthCard {
  readonly provider: string | null;
  readonly setups: number;
  readonly avgSuccess: number | null;
  readonly lowPerforming: number;
  readonly noData: number;
}

export async function healthCards(
  db: AppDb,
  auth: AuthContext,
  clientId: string | null,
): Promise<HealthCard[]> {
  const rows = (await healthRows(db, auth)).filter((r) => !clientId || r.clientId === clientId);
  const card = (provider: string | null, list: readonly HealthRow[]): HealthCard => ({
    provider,
    ...summarizeHealth(list.map((r) => r.successRate)),
  });
  const providers = [...new Set(rows.map((r) => r.provider))].sort();
  return [
    card(null, rows),
    ...providers.map((p) =>
      card(
        p,
        rows.filter((r) => r.provider === p),
      ),
    ),
  ];
}

/* ---------------- missing orders ---------------- */

const mo = s.channelMissingOrders;
const MISSING_BINDING: GridBinding = {
  exprs: {
    orderCode: sql`${mo.orderCode}`,
    channelOrderNumber: sql`${mo.channelOrderNumber}`,
    storeName: sql`${cc.storeName}`,
    provider: sql`${cc.provider}`,
    connectionId: sql`${mo.connectionId}`,
    clientId: sql`${cc.clientId}`,
    clientName: sql`(SELECT c2.name FROM clients c2 WHERE c2.id = ${cc.clientId})`,
    orderDate: sql`${mo.orderDate}`,
    lastUpdated: sql`${mo.lastUpdated}`,
    lastErrorCode: sql`REPLACE(${mo.lastErrorCode}, 'KitStaks', 'KitStak')`,
    status: sql`${mo.status}`,
  },
  fields: MISSING_FIELDS,
  sortable: MISSING_SORT_FIELDS,
  search: ['orderCode', 'channelOrderNumber'],
  defaultSort: [{ field: 'lastUpdated', dir: 'desc' }],
  tiebreaker: mo.id,
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

export async function listMissing(
  db: AppDb,
  auth: AuthContext,
  query: GridQuery,
): Promise<{ rows: MissingRow[]; total: number }> {
  const statusFiltered = query.filters.some((f) => f.field === 'status');
  const grid = compileGrid(MISSING_BINDING, query, [
    connectionScope(auth),
    statusFiltered ? undefined : sql`${mo.status} <> 'Resolved'`,
  ]);
  const result = await paginate(
    db
      .select({ m: mo, c: cc, clientName: s.clients.name })
      .from(mo)
      .innerJoin(cc, eq(cc.id, mo.connectionId))
      .innerJoin(s.clients, eq(s.clients.id, cc.clientId))
      .where(grid.where)
      .orderBy(...grid.orderBy)
      .$dynamic(),
    async () =>
      (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(mo)
          .innerJoin(cc, eq(cc.id, mo.connectionId))
          .where(grid.where)
          .limit(1)
      )[0]?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return {
    rows: result.rows.map(({ m, c, clientName }) => ({
      id: m.id,
      orderCode: m.orderCode,
      channelOrderNumber: m.channelOrderNumber,
      connectionId: c.id,
      storeName: c.storeName,
      provider: c.provider,
      isSandbox: c.distribution === 'API',
      clientName,
      orderDate: m.orderDate,
      lastUpdated: m.lastUpdated,
      lastErrorCode: brandText(m.lastErrorCode),
      status: m.status,
    })),
    total: result.total,
  };
}

export interface MissingDetail extends MissingRow {
  readonly payload: string;
  readonly error: IntegrationErrorInfo;
  readonly history: readonly {
    readonly at: string;
    readonly message: string | null;
    readonly success: boolean;
  }[];
}

export async function getMissing(db: AppDb, auth: AuthContext, id: string): Promise<MissingDetail> {
  const row = assertFound(
    (
      await db
        .select({ m: mo, c: cc, clientName: s.clients.name })
        .from(mo)
        .innerJoin(cc, eq(cc.id, mo.connectionId))
        .innerJoin(s.clients, eq(s.clients.id, cc.clientId))
        .where(eq(mo.id, id))
        .limit(1)
    )[0],
    'Missing order',
  );
  if (!hasClient(auth.scope, row.c.clientId)) throw new AppError('NOT_FOUND', 'Missing order not found');
  const history = await db
    .select({
      at: s.channelRunItems.at,
      message: s.channelRunItems.errorMessage,
      success: s.channelRunItems.success,
    })
    .from(s.channelRunItems)
    .innerJoin(s.channelRuns, eq(s.channelRuns.id, s.channelRunItems.runId))
    .where(
      and(
        eq(s.channelRuns.connectionId, row.c.id),
        eq(s.channelRunItems.storeOrderNumber, row.m.channelOrderNumber),
      ),
    )
    .orderBy(desc(s.channelRunItems.at))
    .limit(10);
  return {
    id: row.m.id,
    orderCode: row.m.orderCode,
    channelOrderNumber: row.m.channelOrderNumber,
    connectionId: row.c.id,
    storeName: row.c.storeName,
    provider: row.c.provider,
    isSandbox: row.c.distribution === 'API',
    clientName: row.clientName,
    orderDate: row.m.orderDate,
    lastUpdated: row.m.lastUpdated,
    lastErrorCode: brandText(row.m.lastErrorCode),
    status: row.m.status,
    payload: row.m.payload,
    error: catalogError(row.m.lastErrorCode),
    history: history.map((h) => ({ ...h, message: brandText(h.message) ?? null })),
  };
}

export async function retryMissing(
  db: AppDb,
  auth: AuthContext,
  ids: readonly string[],
): Promise<BulkResult> {
  const rows = await db
    .select({ id: mo.id, clientId: cc.clientId, status: mo.status })
    .from(mo)
    .innerJoin(cc, eq(cc.id, mo.connectionId))
    .where(inArray(mo.id, [...ids]));
  const allowed = rows
    .filter((r) => hasClient(auth.scope, r.clientId) && r.status !== 'Resolved')
    .map((r) => r.id);
  const rejected = ids
    .filter((id) => !allowed.includes(id))
    .map((id) => ({
      id,
      code: 'INVALID_STATE',
      message: rows.some((r) => r.id === id && r.status === 'Resolved')
        ? 'Already downloaded'
        : 'Missing order not found',
    }));
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
  readonly isSandbox: boolean;
  readonly clientId: string;
  readonly clientName: string;
  readonly occurrences: number;
  readonly affectedOrders: number;
  readonly lastOccurrence: string;
  readonly day: string;
}

export async function recentErrorRows(
  db: AppDb,
  auth: AuthContext,
  now = new Date(),
  tz: string = safeTimeZone(null),
): Promise<RecentErrorRow[]> {
  const since = new Date(now.getTime() - 14 * DAY).toISOString();
  const conns = new Map((await connections(db, auth)).map((x) => [x.c.id, x]));
  if (conns.size === 0) return [];
  const rows = await dbAll<{ cid: string; msg: string | null; at: string; num: string | null }>(
    db,
    sql`
    SELECT r.connection_id AS cid, i.error_message AS msg, i.at AS at, i.store_order_number AS num
    FROM channel_run_items i JOIN channel_runs r ON r.id = i.run_id
    WHERE i.success = false AND r.method = 'Download Orders' AND i.at >= ${since}`,
  );
  // Open missing orders are the same download errors (Logiwa groups them here too). Count the ones
  // that have no failed run item in the window (imports, older runs, pruned logs), so this page
  // always reconciles with Missing Shipment Orders.
  const seen = new Set(rows.filter((x) => x.num).map((x) => `${x.cid}|${x.num}`));
  const missingRows = await dbAll<{ cid: string; msg: string; at: string; num: string }>(
    db,
    sql`
    SELECT m.connection_id AS cid, m.last_error_code AS msg, m.last_updated AS at, m.channel_order_number AS num
    FROM channel_missing_orders m WHERE m.status <> 'Resolved' AND m.last_updated >= ${since}`,
  );
  for (const x of missingRows) if (!seen.has(`${x.cid}|${x.num}`)) rows.push(x);
  const grouped = new Map<string, { row: RecentErrorRow; orders: Set<string> }>();
  for (const x of rows) {
    const conn = conns.get(x.cid);
    if (!conn) continue;
    const reason = brandText((x.msg ?? 'Unexpected Error').split(':')[0]?.trim() || 'Unexpected Error');
    // Bucket by the viewer's local day, the same zone the grid renders timestamps in.
    const day = dayKeyInZone(x.at, tz);
    const key = `${x.cid}|${reason}|${day}`;
    const prev = grouped.get(key);
    const orders = prev?.orders ?? new Set<string>();
    if (x.num) orders.add(x.num);
    grouped.set(key, {
      orders,
      row: {
        id: key,
        errorReason: reason,
        connectionId: x.cid,
        storeName: conn.c.storeName,
        provider: conn.c.provider,
        isSandbox: conn.c.distribution === 'API',
        clientId: conn.c.clientId,
        clientName: conn.clientName,
        occurrences: (prev?.row.occurrences ?? 0) + 1,
        affectedOrders: orders.size,
        lastOccurrence: prev && prev.row.lastOccurrence > x.at ? prev.row.lastOccurrence : x.at,
        day,
      },
    });
  }
  return [...grouped.values()]
    .map((g) => g.row)
    .sort((a, b) => b.lastOccurrence.localeCompare(a.lastOccurrence));
}

export async function listRecentErrors(db: AppDb, auth: AuthContext, query: GridQuery, tz?: string | null) {
  return local(
    await recentErrorRows(db, auth, new Date(), await bucketZone(db, auth, tz)),
    { ...query, sort: query.sort.length > 0 ? query.sort : [{ field: 'lastOccurrence', dir: 'desc' }] },
    ['errorReason', 'storeName'],
  );
}

/** Drilldown: the orders affected by one grouped error (beyond Logiwa). `day` is a local day in `tz`. */
export async function recentErrorOrders(
  db: AppDb,
  auth: AuthContext,
  connectionId: string,
  reason: string,
  day: string,
  tz?: string | null,
) {
  const conn = assertFound(
    (await db.select().from(cc).where(eq(cc.id, connectionId)).limit(1))[0],
    'Store connection',
  );
  if (!hasClient(auth.scope, conn.clientId)) throw new AppError('NOT_FOUND', 'Store connection not found');
  const zone = await bucketZone(db, auth, tz);
  const base = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(base)) throw new AppError('VALIDATION', 'Invalid day');
  // ±1 UTC day window in SQL, then the exact local-day match in JS.
  const from = new Date(base - DAY).toISOString();
  const to = new Date(base + 2 * DAY).toISOString();
  const items = (
    await db
      .select({ i: s.channelRunItems })
      .from(s.channelRunItems)
      .innerJoin(s.channelRuns, eq(s.channelRuns.id, s.channelRunItems.runId))
      .where(
        and(
          eq(s.channelRuns.connectionId, connectionId),
          eq(s.channelRunItems.success, false),
          sql`REPLACE(${s.channelRunItems.errorMessage}, 'KitStaks', 'KitStak') ILIKE ${`${brandText(reason)}%`}`,
          sql`${s.channelRunItems.at} >= ${from}`,
          sql`${s.channelRunItems.at} < ${to}`,
        ),
      )
      .orderBy(desc(s.channelRunItems.at))
      .limit(1000)
  )
    .filter((x) => dayKeyInZone(x.i.at, zone) === day)
    .slice(0, 200);
  const numbers = [...new Set(items.map((x) => x.i.storeOrderNumber).filter((v): v is string => Boolean(v)))];
  const missing =
    numbers.length === 0
      ? []
      : await db
          .select()
          .from(mo)
          .where(and(eq(mo.connectionId, connectionId), inArray(mo.channelOrderNumber, numbers)));
  const fromItems = numbers.map((n) => {
    const m = missing.find((x) => x.channelOrderNumber === n);
    const last = items.find((x) => x.i.storeOrderNumber === n);
    return {
      storeOrderNumber: n,
      missingOrderId: m?.id ?? null,
      orderCode: m?.orderCode ?? null,
      status: m?.status ?? 'Error',
      lastErrorCode: brandText(m?.lastErrorCode ?? reason),
      message: brandText(last?.i.errorMessage) ?? null,
      at: last?.i.at ?? '',
    };
  });
  // Open missing orders with this error and no run item (same rule as recentErrorRows).
  const have = new Set(numbers);
  const extra = (
    await db
      .select()
      .from(mo)
      .where(
        and(
          eq(mo.connectionId, connectionId),
          sql`${mo.status} <> 'Resolved'`,
          sql`REPLACE(${mo.lastErrorCode}, 'KitStaks', 'KitStak') = ${brandText(reason)}`,
          sql`${mo.lastUpdated} >= ${from}`,
          sql`${mo.lastUpdated} < ${to}`,
        ),
      )
      .orderBy(desc(mo.lastUpdated))
  )
    .filter((m) => !have.has(m.channelOrderNumber) && dayKeyInZone(m.lastUpdated, zone) === day)
    .map((m) => ({
      storeOrderNumber: m.channelOrderNumber,
      missingOrderId: m.id,
      orderCode: m.orderCode,
      status: m.status,
      lastErrorCode: brandText(m.lastErrorCode),
      message: brandText(m.lastErrorCode) ?? null,
      at: m.lastUpdated,
    }));
  return [...fromItems, ...extra].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
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

export async function blockedRows(db: AppDb, auth: AuthContext): Promise<BlockedRow[]> {
  const o = s.shipmentOrders;
  const wh = auth.viewScope.warehouseIds;
  if (wh.length === 0) return [];
  const orders = await db
    .select({
      o,
      clientName: s.clients.name,
      whCode: s.warehouses.code,
      store: cc.storeName,
      provider: cc.provider,
    })
    .from(o)
    .innerJoin(s.clients, eq(s.clients.id, o.clientId))
    .innerJoin(s.warehouses, eq(s.warehouses.id, o.warehouseId))
    .leftJoin(cc, eq(cc.id, o.channelConnectionId))
    .where(
      and(
        sql`${o.workflowBlocked} <> 'None'`,
        sql`${o.deletedAt} IS NULL`,
        inArray(o.warehouseId, [...wh]),
        connectionScope(auth, sql`${o.clientId}`),
      ),
    );
  if (orders.length === 0) return [];
  const runs = await db
    .select({ r: s.workflowRuns, name: s.workflows.name })
    .from(s.workflowRuns)
    .leftJoin(s.workflows, eq(s.workflows.id, s.workflowRuns.workflowId))
    .where(
      and(
        inArray(
          s.workflowRuns.entityId,
          orders.map((x) => x.o.id),
        ),
        sql`${s.workflowRuns.blockType} IS NOT NULL`,
      ),
    )
    .orderBy(desc(s.workflowRuns.at));
  return orders.map(({ o: x, clientName, whCode, store, provider }) => {
    const run = runs.find((r) => r.r.entityId === x.id);
    return {
      id: x.id,
      orderCode: x.code,
      blockType: x.workflowBlocked,
      storeName: store ?? x.storeName,
      provider: provider ?? null,
      clientId: x.clientId,
      clientName,
      orderDate: x.orderDate,
      workflowId: run?.r.workflowId ?? null,
      workflowName: run?.name ?? null,
      actionName: x.workflowBlocked === 'Fully' ? 'Block Order' : 'Partially Block Order',
      warehouseId: x.warehouseId,
      warehouseCode: whCode,
      status: x.status,
      blockedAt: run?.r.at ?? null,
    };
  });
}

export async function listBlocked(db: AppDb, auth: AuthContext, query: GridQuery) {
  return local(
    await blockedRows(db, auth),
    { ...query, sort: query.sort.length > 0 ? query.sort : [{ field: 'orderDate', dir: 'desc' }] },
    ['orderCode', 'storeName', 'workflowName'],
  );
}

export async function releaseBlocked(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  ids: readonly string[],
): Promise<BulkResult> {
  const ctx = domainCtxOf(actor, auth);
  const o = s.shipmentOrders;
  return await runBulk(tx, ids, async (inner, id) => {
    const order = (await inner.select().from(o).where(eq(o.id, id)).limit(1))[0];
    if (!order || !hasWarehouse(auth.scope, order.warehouseId) || !hasClient(auth.scope, order.clientId))
      throw new AppError('NOT_FOUND', 'Shipment order not found');
    if (order.workflowBlocked === 'None')
      throw new AppError('INVALID_STATE', `Order ${order.code} is not blocked by a workflow`);
    await inner
      .update(o)
      .set({ workflowBlocked: 'None', updatedBy: actor.userId, version: sql`${o.version} + 1` })
      .where(eq(o.id, id));
    await recordUpdate(inner, ctx, {
      entityType: 'shipment_order',
      entityId: id,
      entityCode: order.code,
      before: { workflowBlocked: order.workflowBlocked },
      after: { workflowBlocked: 'None' },
    });
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
  readonly issueType: 'Multi Listing' | 'SKU Difference';
  readonly listingDate: string;
}

export async function listingExceptionRows(db: AppDb, auth: AuthContext): Promise<ListingExceptionRow[]> {
  const l = s.productListings;
  const rows = await db
    .select({ l, sku: s.products.sku, c: cc, clientName: s.clients.name })
    .from(l)
    .innerJoin(s.products, eq(s.products.id, l.productId))
    .innerJoin(cc, eq(cc.id, l.channelConnectionId))
    .innerJoin(s.clients, eq(s.clients.id, cc.clientId))
    .where(connectionScope(auth));
  const out: ListingExceptionRow[] = [];
  const groups = new Map<string, typeof rows>();
  for (const r of rows)
    groups.set(`${r.c.id}|${r.l.productId}`, [...(groups.get(`${r.c.id}|${r.l.productId}`) ?? []), r]);
  for (const [key, list] of groups) {
    const first = list[0];
    if (!first) continue;
    const base = {
      productId: first.l.productId as string,
      sku: first.sku,
      connectionId: first.c.id,
      storeName: first.c.storeName,
      provider: first.c.provider,
      clientId: first.c.clientId,
      clientName: first.clientName,
    };
    if (list.length > 1) {
      out.push({
        ...base,
        id: `${key}|multi`,
        sellerSkus: list.map((x) => x.l.sellerSku).join(', '),
        channelProductIds: list.map((x) => x.l.channelProductId).join(', '),
        issueType: 'Multi Listing',
        listingDate:
          list
            .map((x) => x.l.createdAt)
            .sort()
            .at(-1) ?? first.l.createdAt,
      });
    }
    for (const x of list) {
      if (x.l.sellerSku.trim().toLowerCase() !== x.sku.trim().toLowerCase()) {
        out.push({
          ...base,
          id: `${x.l.id}|diff`,
          sellerSkus: x.l.sellerSku,
          channelProductIds: x.l.channelProductId,
          issueType: 'SKU Difference',
          listingDate: x.l.createdAt,
        });
      }
    }
  }
  return out;
}

export async function listListingExceptions(db: AppDb, auth: AuthContext, query: GridQuery) {
  return local(
    await listingExceptionRows(db, auth),
    { ...query, sort: query.sort.length > 0 ? query.sort : [{ field: 'listingDate', dir: 'desc' }] },
    ['sku', 'sellerSkus'],
  );
}

/* ---------------- setup details ---------------- */

export interface SetupMethodStat {
  readonly method: string;
  readonly status: 'Active' | 'Passive';
  readonly jobStatus: string;
  readonly lastCallAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly calls14d: number;
  readonly errors14d: number;
  readonly successRate: number | null;
}

/** Most recently active setup visible to the caller (default for Setup Details). */
export async function defaultSetupId(db: AppDb, auth: AuthContext): Promise<string | null> {
  const rows = await healthRows(db, auth);
  if (rows.length === 0) return null;
  const key = (r: HealthRow) => r.lastCallAt ?? r.lastSuccessAt ?? '';
  return [...rows].sort((a, b) => key(b).localeCompare(key(a)) || a.storeName.localeCompare(b.storeName))[0]!
    .id;
}

export interface SetupDetails {
  readonly id: string;
  readonly storeName: string;
  readonly provider: string;
  readonly isSandbox: boolean;
  readonly clientName: string;
  readonly warehouses: readonly string[];
  readonly successRate: number | null;
  readonly successes24h: number;
  readonly errors24h: number;
  readonly methods: readonly SetupMethodStat[];
  readonly callTrend: readonly { readonly day: string; readonly ok: number; readonly errors: number }[];
  readonly volume: readonly { readonly day: string; readonly channel: number; readonly kitstaks: number }[];
  readonly missing: readonly MissingRow[];
  readonly blocked: readonly BlockedRow[];
  readonly listingExceptions: readonly ListingExceptionRow[];
  readonly recentErrors: readonly RecentErrorRow[];
  readonly counts: {
    readonly missing: number;
    readonly blocked: number;
    readonly listingExceptions: number;
    readonly recentErrors: number;
  };
}

export async function setupDetails(
  db: AppDb,
  auth: AuthContext,
  id: string,
  now = new Date(),
  tz?: string | null,
): Promise<SetupDetails> {
  const conn = assertFound(
    (
      await db
        .select({ c: cc, clientName: s.clients.name })
        .from(cc)
        .innerJoin(s.clients, eq(s.clients.id, cc.clientId))
        .where(eq(cc.id, id))
        .limit(1)
    )[0],
    'Store connection',
  );
  if (!hasClient(auth.scope, conn.c.clientId)) throw new AppError('NOT_FOUND', 'Store connection not found');
  const zone = await bucketZone(db, auth, tz);
  const health = (await healthRows(db, auth, now)).find((h) => h.id === id);
  // 14 local calendar days (today last). 15 UTC days of rows cover them in any zone.
  const days = lastDaysInZone(now, 14, zone);
  const daySet = new Set(days);
  const sinceIso = new Date(now.getTime() - 15 * DAY).toISOString();
  const channelItems = await dbAll<{ at: string; num: string | null }>(
    db,
    sql`
    SELECT i.at AS at, i.store_order_number AS num FROM channel_run_items i JOIN channel_runs r ON r.id = i.run_id
    WHERE r.connection_id = ${id} AND r.method = 'Download Orders' AND i.at >= ${sinceIso}`,
  );
  const channelSets = new Map<string, Set<string>>();
  channelItems.forEach((r, i) => {
    const k = dayKeyInZone(r.at, zone);
    const set = channelSets.get(k) ?? new Set<string>();
    set.add(r.num ?? `#${i}`);
    channelSets.set(k, set);
  });
  const ksCounts = new Map<string, number>();
  for (const r of await dbAll<{ at: string }>(
    db,
    sql`SELECT created_at AS at FROM shipment_orders WHERE channel_connection_id = ${id} AND created_at >= ${sinceIso}`,
  )) {
    const k = dayKeyInZone(r.at, zone);
    ksCounts.set(k, (ksCounts.get(k) ?? 0) + 1);
  }
  const volume = days.map((day) => ({
    day,
    channel: channelSets.get(day)?.size ?? 0,
    kitstaks: ksCounts.get(day) ?? 0,
  }));
  const methodRows = await db.select().from(s.channelMethods).where(eq(s.channelMethods.connectionId, id));
  const runRows = (
    await dbAll<{ method: string; at: string; ok: number | null; bad: number | null }>(
      db,
      sql`
    SELECT method, started_at AS at, success_count AS ok, error_count AS bad FROM channel_runs WHERE connection_id = ${id} AND started_at >= ${sinceIso}`,
    )
  )
    .map((r) => ({ ...r, day: dayKeyInZone(r.at, zone) }))
    .filter((r) => daySet.has(r.day));
  const methods: SetupMethodStat[] = methodRows
    .map((m) => {
      const mine = runRows.filter((x) => x.method === m.method);
      const ok = mine.reduce((n, x) => n + Number(x.ok ?? 0), 0);
      const bad = mine.reduce((n, x) => n + Number(x.bad ?? 0), 0);
      return {
        method: m.method,
        status: m.status,
        jobStatus: m.jobStatus,
        lastCallAt: m.lastRunAt,
        lastSuccessAt: m.lastSuccessAt,
        calls14d: ok + bad,
        errors14d: bad,
        successRate: successRateOf(ok, bad),
      };
    })
    .sort((a, b) => a.method.localeCompare(b.method));
  const callTrend = days.map((day) => {
    const mine = runRows.filter((r) => r.day === day);
    return {
      day,
      ok: mine.reduce((n, x) => n + Number(x.ok ?? 0), 0),
      errors: mine.reduce((n, x) => n + Number(x.bad ?? 0), 0),
    };
  });
  const missingAll = await db
    .select({ m: mo })
    .from(mo)
    .where(and(eq(mo.connectionId, id), sql`${mo.status} <> 'Resolved'`))
    .orderBy(desc(mo.lastUpdated));
  const blocked = (await blockedRows(db, auth)).filter((b) => b.storeName === conn.c.storeName);
  const exceptions = (await listingExceptionRows(db, auth)).filter((e) => e.connectionId === id);
  const errors = (await recentErrorRows(db, auth, now, zone)).filter((e) => e.connectionId === id);
  const wh = await db
    .select({ code: s.warehouses.code })
    .from(s.channelLocationMappings)
    .innerJoin(s.warehouses, eq(s.warehouses.id, s.channelLocationMappings.warehouseId))
    .where(eq(s.channelLocationMappings.connectionId, id));
  return {
    id,
    storeName: conn.c.storeName,
    provider: conn.c.provider,
    isSandbox: conn.c.distribution === 'API',
    clientName: conn.clientName,
    warehouses: [...new Set(wh.map((w) => w.code))],
    successRate: health?.successRate ?? null,
    successes24h: health?.successes24h ?? 0,
    errors24h: health?.errors24h ?? 0,
    methods,
    callTrend,
    volume,
    missing: missingAll
      .slice(0, 5)
      .map(({ m }) => ({
        id: m.id,
        orderCode: m.orderCode,
        channelOrderNumber: m.channelOrderNumber,
        connectionId: id,
        storeName: conn.c.storeName,
        provider: conn.c.provider,
        isSandbox: conn.c.distribution === 'API',
        clientName: conn.clientName,
        orderDate: m.orderDate,
        lastUpdated: m.lastUpdated,
        lastErrorCode: brandText(m.lastErrorCode),
        status: m.status,
      })),
    blocked: blocked.slice(0, 5),
    listingExceptions: exceptions.slice(0, 5),
    recentErrors: errors.slice(0, 5),
    counts: {
      missing: missingAll.length,
      blocked: blocked.length,
      listingExceptions: exceptions.length,
      recentErrors: errors.length,
    },
  };
}
