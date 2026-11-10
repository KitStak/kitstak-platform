/**
 * Packing Station reads (M04 §1–2): stations (Packing area locations), dashboard KPIs,
 * the Tote / Location / Putwall-Mobile Cart / Order scan resolution and the
 * List & Select order list. Every read is scoped (cross-scope = not found).
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import type { Scope } from "@/server/auth/scope";
import { hasClient, hasWarehouse } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { hospitalLocations } from "./packing-hospitals";
import { locationLock, packLock, packLockMessage } from "./packing-locks";
/** `warehouseId` query param with a friendly message when missing (station dashboards, KPIs). */
export const warehouseIdParam = z.string({ error: "Choose a warehouse" }).trim().min(1, "Choose a warehouse").max(64);

export const PACKING_PERMISSIONS = {
  view: "fulfillment.packing_station.view",
  reportIssue: "fulfillment.packing_station.report_issue",
  printSlip: "fulfillment.packing_station.print_packing_slip",
  execute: "fulfillment.task_details.execute_task",
  createLabel: "fulfillment.shipment_orders.create_label",
} as const;

export const PACK_MODES = ["tote", "location", "order", "putwall"] as const;
export type PackMode = (typeof PACK_MODES)[number];

export const PACKABLE_STATUSES = ["Ready to Pack", "Packing Started"] as const;

/** Logiwa's message when the scanned thing holds no order that can be packed. */
/** Order-mode wording when the scanned order exists but cannot be packed (says why). */
export function notPackableOrderMessage(code: string, status: string): string {
  const s = status.toLowerCase();
  if (["ready to ship", "shipped", "packed", "delivered"].some((x) => s.includes(x))) return `${code} is ${status} (already packed). Open the order to reprint the label.`;
  if (s.includes("cancel")) return `${code} is ${status} and cannot be packed.`;
  if (s.includes("hold")) return `${code} is ${status}. Release the hold before packing.`;
  return `${code} is ${status} and has no picked units ready to pack.`;
}

export const NO_ALLOCATED_ORDER = "No allocated order found. Please transfer the products to another location.";

function assertWarehouse(scope: Scope, warehouseId: string): void {
  if (!hasWarehouse(scope, warehouseId)) throw new DomainError("NOT_FOUND", "Warehouse not found");
}

function clientScope(scope: Scope, column: string): SQL {
  if (scope.clientIds === "all") return sql`1 = 1`;
  if (scope.clientIds.length === 0) return sql`0 = 1`;
  return sql`${sql.raw(column)} IN (${sql.join(scope.clientIds.map((c) => sql`${c}`), sql`, `)})`;
}

/* --------------------------------------------------------------- stations */

export interface PackingStation {
  readonly id: string;
  readonly code: string;
  readonly warehouseId: string;
  readonly description: string | null;
  /** Open count plan locking the station (packing into it would be refused). */
  readonly countLockPlan?: string | null;
}

export function packingStations(db: AppDb, scope: Scope, warehouseId: string): PackingStation[] {
  assertWarehouse(scope, warehouseId);
  return db.select({ id: schema.locations.id, code: schema.locations.code, warehouseId: schema.locations.warehouseId, description: schema.locations.displayMember })
    .from(schema.locations)
    .where(and(eq(schema.locations.warehouseId, warehouseId), eq(schema.locations.areaType, "Packing"), eq(schema.locations.isActive, true)))
    .orderBy(schema.locations.code).all()
    .map((s) => ({ ...s, countLockPlan: locationLock(db, s.id)?.planCode ?? null }));
}

export function loadStation(db: AppDb, scope: Scope, stationId: string): PackingStation {
  // The id, or a station code (e.g. PACK-01) as a URL alias: a Packing-area location in the user's warehouses.
  const loc = db.select().from(schema.locations).where(eq(schema.locations.id, stationId)).get()
    ?? db.all<{ id: string }>(sql`SELECT id FROM locations WHERE lower(code) = ${stationId.trim().toLowerCase()} AND area_type = 'Packing' ORDER BY code`)
      .map((r) => db.select().from(schema.locations).where(eq(schema.locations.id, r.id)).get())
      .find((r) => r && hasWarehouse(scope, r.warehouseId));
  if (!loc || !hasWarehouse(scope, loc.warehouseId)) throw new DomainError("NOT_FOUND", "Packing station not found");
  if (loc.areaType !== "Packing") throw new DomainError("VALIDATION", `${loc.code} is not a packing station.`);
  return { id: loc.id, code: loc.code, warehouseId: loc.warehouseId, description: loc.displayMember };
}

/* ------------------------------------------------------------------- KPIs */

export interface PackingKpis {
  readonly ordersPackedToday: number;
  readonly productsPackedToday: number;
  readonly ordersToPack: number;
  /** Orders held with an open pack short (Report Issue moved their stock to a hospital). */
  readonly packShortHeld: number;
  /** Units sitting in the warehouse's designated hospital locations. */
  readonly hospitalUnits: number;
  /** Orders to pack that carry a Packing Warning Type (shown to the packer at its trigger). */
  readonly ordersWithWarnings: number;
  /** The chosen station's totals today (every packer), when a station is given. */
  readonly station: { readonly id: string; readonly code: string; readonly ordersPackedToday: number; readonly productsPackedToday: number; readonly packers: number } | null;
}

export function packingKpis(db: AppDb, scope: Scope, warehouseId: string, userId: string | null, now = new Date(), stationId: string | null = null): PackingKpis {
  assertWarehouse(scope, warehouseId);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const since = start.toISOString();
  const mine = db.get<{ orders: number; units: number }>(sql`SELECT COUNT(DISTINCT order_id) AS orders, COALESCE(SUM(actual_qty), 0) AS units FROM tasks
    WHERE task_type = 'Packing' AND status = 'Completed' AND warehouse_id = ${warehouseId} AND executed_by_user_id = ${userId ?? ""} AND finished_at >= ${since}`);
  // Same query as List & Select, so the tile and the modal always agree.
  const ready = readyToPackOrders(db, scope, { warehouseId }, { locks: false });
  const warned = ready.length === 0 ? 0 : db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE packing_warning_type_id IS NOT NULL
    AND id IN (${sql.join(ready.map((r) => sql`${r.id}`), sql`, `)})`)?.n ?? 0;
  const held = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipment_orders o WHERE o.warehouse_id = ${warehouseId} AND o.pack_short_status = 'Open'
    AND o.status IN ('Ready to Pack', 'Packing Started') AND o.deleted_at IS NULL AND ${clientScope(scope, "o.client_id")}`)?.n ?? 0;
  const hosp = hospitalLocations(db, warehouseId);
  const hospitalUnits = hosp.length === 0 ? 0 : db.get<{ n: number }>(sql`SELECT COALESCE(SUM(on_hand), 0) AS n FROM inventory WHERE location_id IN (${sql.join(hosp.map((h) => sql`${h.id}`), sql`, `)})`)?.n ?? 0;
  let station: PackingKpis["station"] = null;
  if (stationId) {
    const st = db.select({ id: schema.locations.id, code: schema.locations.code, warehouseId: schema.locations.warehouseId }).from(schema.locations).where(eq(schema.locations.id, stationId)).get();
    if (st && st.warehouseId === warehouseId) {
      const r = db.get<{ orders: number; units: number; packers: number }>(sql`SELECT COUNT(DISTINCT order_id) AS orders, COALESCE(SUM(actual_qty), 0) AS units, COUNT(DISTINCT executed_by_user_id) AS packers FROM tasks
        WHERE task_type = 'Packing' AND status = 'Completed' AND warehouse_id = ${warehouseId} AND target_location_id = ${st.id} AND finished_at >= ${since}`);
      station = { id: st.id, code: st.code, ordersPackedToday: r?.orders ?? 0, productsPackedToday: r?.units ?? 0, packers: r?.packers ?? 0 };
    }
  }
  return {
    ordersPackedToday: mine?.orders ?? 0, productsPackedToday: mine?.units ?? 0, ordersToPack: ready.length,
    packShortHeld: held, hospitalUnits, ordersWithWarnings: warned, station,
  };
}

/** One order the user finished packing (Logiwa packing dashboard "history"). */
export interface PackHistoryRow {
  readonly orderId: string;
  readonly orderCode: string;
  readonly status: string;
  readonly clientName: string;
  readonly customerName: string | null;
  readonly units: number;
  readonly packages: number;
  readonly trackingNumber: string | null;
  readonly stationCode: string | null;
  readonly packedAt: string;
}

/**
 * Orders the user completed packing in a warehouse since `since` (default: start of today),
 * newest first. "Clear completed" on the dashboard narrows the window by moving `since`.
 */
export function packingHistory(db: AppDb, scope: Scope, warehouseId: string, userId: string | null, opts: { readonly since?: string | null; readonly now?: Date; readonly limit?: number } = {}): PackHistoryRow[] {
  assertWarehouse(scope, warehouseId);
  const start = new Date(opts.now ?? new Date());
  start.setHours(0, 0, 0, 0);
  const dayStart = start.toISOString();
  const since = opts.since && opts.since > dayStart ? opts.since : dayStart;
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  return db.all<PackHistoryRow>(sql`
    SELECT t.order_id AS orderId, so.code AS orderCode, so.status AS status, c.name AS clientName, so.customer_name AS customerName,
      SUM(t.actual_qty) AS units, MAX(t.finished_at) AS packedAt,
      (SELECT COUNT(*) FROM shipments s WHERE s.order_id = t.order_id AND s.label_status = 'Active') AS packages,
      (SELECT COALESCE(s.master_tracking_number, s.tracking_number) FROM shipments s WHERE s.order_id = t.order_id AND s.label_status = 'Active' ORDER BY s.label_created_at DESC LIMIT 1) AS trackingNumber,
      MAX(l.code) AS stationCode
    FROM tasks t JOIN shipment_orders so ON so.id = t.order_id JOIN clients c ON c.id = so.client_id
      LEFT JOIN locations l ON l.id = t.target_location_id
    WHERE t.task_type = 'Packing' AND t.status = 'Completed' AND t.warehouse_id = ${warehouseId} AND t.executed_by_user_id = ${userId ?? ""}
      AND t.finished_at >= ${since} AND ${clientScope(scope, "so.client_id")}
    GROUP BY t.order_id ORDER BY packedAt DESC LIMIT ${limit}`);
}

/* ------------------------------------------------------------------- scan */

export interface PackOrderSummary {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly clientName: string;
  readonly customerName: string;
  readonly unitsToPack: number;
  readonly packable: boolean;
  readonly packShortStatus: string;
  /** Count-plan lock (station or staged stock) that would stop Complete: shown before packing starts. */
  readonly countLock: { readonly planCode: string; readonly planId: string | null; readonly locationCode: string; readonly reason: string } | null;
}

export interface ScanResult {
  readonly mode: PackMode;
  readonly code: string;
  readonly sourceLabel: string;
  readonly job: { readonly id: string; readonly code: string; readonly jobType: string } | null;
  readonly orders: readonly PackOrderSummary[];
  readonly totalOrders: number;
  readonly packedOrders: number;
  /** Order mode only: the scanned order exists but cannot be packed, and why. */
  readonly blocked?: { readonly orderId: string; readonly orderCode: string; readonly status: string; readonly message: string };
}

interface OrderIdRow { readonly orderId: string }

function ordersHolding(db: AppDb, where: SQL): string[] {
  return db.all<OrderIdRow>(sql`SELECT DISTINCT a.order_id AS orderId FROM inventory_allocations a JOIN inventory i ON i.id = a.inventory_id
    WHERE a.order_id IS NOT NULL AND a.status IN ('Picked', 'Sorted', 'Packed') AND ${where}`).map((r) => r.orderId);
}

/** Units still to pack per order (pending Packing tasks, capped by picked stock). */
export function unitsToPack(db: AppDb, orderId: string): number {
  const planned = db.get<{ n: number }>(sql`SELECT COALESCE(SUM(planned_qty - actual_qty), 0) AS n FROM tasks WHERE order_id = ${orderId} AND task_type = 'Packing' AND status IN ('Pending', 'Started')`)?.n ?? 0;
  const picked = db.get<{ n: number }>(sql`SELECT COALESCE(SUM(qty), 0) AS n FROM inventory_allocations WHERE order_id = ${orderId} AND status IN ('Picked', 'Sorted')`)?.n ?? 0;
  return Math.min(planned, picked);
}

function lockSummary(db: AppDb, orderId: string, orderCode: string, stationId: string | null | undefined): PackOrderSummary["countLock"] {
  const l = packLock(db, orderId, stationId);
  return l ? { planCode: l.planCode, planId: l.planId, locationCode: l.locationCode, reason: packLockMessage(orderCode, l, stationId) } : null;
}

function summarize(db: AppDb, scope: Scope, warehouseId: string, ids: readonly string[], stationId?: string | null): PackOrderSummary[] {
  if (ids.length === 0) return [];
  const rows = db.select({ o: schema.shipmentOrders, clientName: schema.clients.name }).from(schema.shipmentOrders)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.shipmentOrders.clientId))
    .where(sql`${schema.shipmentOrders.id} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`).all()
    .filter((r) => r.o.warehouseId === warehouseId && hasClient(scope, r.o.clientId) && !r.o.deletedAt);
  return rows.map(({ o, clientName }) => {
    const units = unitsToPack(db, o.id);
    return {
      id: o.id, code: o.code, status: o.status, clientName, customerName: o.customerName, unitsToPack: units,
      packable: (PACKABLE_STATUSES as readonly string[]).includes(o.status) && units > 0 && o.packShortStatus !== "Open", packShortStatus: o.packShortStatus,
      countLock: lockSummary(db, o.id, o.code, stationId),
    };
  }).sort((a, b) => Number(b.packable) - Number(a.packable) || Number(!!a.countLock) - Number(!!b.countLock) || a.code.localeCompare(b.code));
}

function jobOf(db: AppDb, orderIds: readonly string[]): ScanResult["job"] {
  for (const id of orderIds) {
    const o = db.select({ jobId: schema.shipmentOrders.jobId }).from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).get();
    if (!o?.jobId) continue;
    const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, o.jobId)).get();
    if (!job) continue;
    const type = job.jobTypeId ? db.select({ d: schema.jobTypes.description, c: schema.jobTypes.code }).from(schema.jobTypes).where(eq(schema.jobTypes.id, job.jobTypeId)).get() : undefined;
    return { id: job.id, code: job.code, jobType: type?.d ?? type?.c ?? job.jobType };
  }
  return null;
}

/** The scanned text as typed, upper- and lower-cased: printed codes match exactly, so these hit the indexes. */
export function codeVariants(code: string): string[] {
  const c = code.trim();
  return [...new Set([c, c.toUpperCase(), c.toLowerCase()])];
}

/**
 * Orders by code, store order # or tracking number. Index-friendly first (`code`,
 * `store_order_number` and `shipments.tracking_number` are indexed, so a scan answers in
 * well under a millisecond at any volume); a case-insensitive pass runs only on a miss.
 */
export function findOrdersByCode(db: AppDb, warehouseId: string, code: string): string[] {
  const v = sql.join(codeVariants(code).map((c) => sql`${c}`), sql`, `);
  const fast = db.all<{ id: string }>(sql`SELECT id FROM shipment_orders WHERE warehouse_id = ${warehouseId} AND deleted_at IS NULL AND id IN (
      SELECT id FROM shipment_orders WHERE code IN (${v})
      UNION SELECT id FROM shipment_orders WHERE store_order_number IN (${v})
      UNION SELECT order_id FROM shipments WHERE tracking_number IN (${v}) AND order_id IS NOT NULL) LIMIT 20`).map((r) => r.id);
  if (fast.length > 0) return fast;
  const lc = code.trim().toLowerCase();
  return db.all<{ id: string }>(sql`SELECT id FROM shipment_orders WHERE warehouse_id = ${warehouseId} AND deleted_at IS NULL
    AND (lower(code) = ${lc} OR lower(store_order_number) = ${lc} OR lower(tracking_number) = ${lc}) LIMIT 20`).map((r) => r.id);
}

export const scanQuerySchema = z.object({
  warehouseId: warehouseIdParam,
  mode: z.enum(PACK_MODES),
  code: z.string().trim().min(1, "Scan or enter a code").max(120),
  stationId: z.string().trim().max(64).optional(),
});

export function resolveScan(db: AppDb, scope: Scope, input: z.output<typeof scanQuerySchema>): ScanResult {
  assertWarehouse(scope, input.warehouseId);
  const lc = input.code.trim().toLowerCase();
  let ids: string[] = [];
  let sourceLabel = input.code;
  if (input.mode === "order") {
    ids = findOrdersByCode(db, input.warehouseId, input.code);
    if (ids.length === 0) throw new DomainError("NOT_FOUND", `No order found for "${input.code}".`);
  } else if (input.mode === "location") {
    const loc = db.get<{ id: string; code: string }>(sql`SELECT id, code FROM locations WHERE warehouse_id = ${input.warehouseId} AND (lower(code) = ${lc} OR lower(barcode) = ${lc}) LIMIT 1`);
    if (!loc) throw new DomainError("NOT_FOUND", `No location found for "${input.code}".`);
    sourceLabel = loc.code;
    ids = ordersHolding(db, sql`i.location_id = ${loc.id}`);
  } else if (input.mode === "tote") {
    const lp = db.get<{ id: string; number: string }>(sql`SELECT id, number FROM license_plates WHERE warehouse_id = ${input.warehouseId} AND (lower(number) = ${lc} OR lower(alternate_barcode) = ${lc}) LIMIT 1`);
    if (!lp) throw new DomainError("NOT_FOUND", `No tote found for "${input.code}".`);
    sourceLabel = lp.number;
    ids = ordersHolding(db, sql`i.lp_id = ${lp.id}`);
  } else {
    const cart = db.get<{ id: string; code: string; jobId: string | null }>(sql`SELECT id, code, current_job_id AS jobId FROM mobile_carts WHERE warehouse_id = ${input.warehouseId} AND lower(code) = ${lc} LIMIT 1`);
    if (!cart) throw new DomainError("NOT_FOUND", `No putwall or mobile cart found for "${input.code}".`);
    sourceLabel = cart.code;
    const cells = db.all<OrderIdRow>(sql`SELECT DISTINCT order_id AS orderId FROM mobile_cart_cells WHERE cart_id = ${cart.id} AND order_id IS NOT NULL`).map((r) => r.orderId);
    const viaJob = cart.jobId ? db.all<OrderIdRow>(sql`SELECT order_id AS orderId FROM job_orders WHERE job_id = ${cart.jobId}`).map((r) => r.orderId) : [];
    const viaStock = ordersHolding(db, sql`i.mobile_cart_id = ${cart.id}`);
    ids = [...new Set([...cells, ...viaJob, ...viaStock])];
  }
  const orders = summarize(db, scope, input.warehouseId, ids, input.stationId);
  if (!orders.some((o) => o.packable)) {
    const short = orders.find((o) => o.packShortStatus === "Open" && (PACKABLE_STATUSES as readonly string[]).includes(o.status));
    if (short) throw new DomainError("INVALID_STATE", `${short.code} has an open pack short issue. Resolve the pack short on the order before packing it.`, { orderId: short.id, orderCode: short.code });
    if (input.mode === "order" && orders.length > 0) {
      // Order mode: answer with the order and why it can't be packed, so the screen can link to it.
      const o = orders[0];
      return { mode: input.mode, code: input.code, sourceLabel, job: null, orders, totalOrders: orders.length, packedOrders: orders.length, blocked: { orderId: o.id, orderCode: o.code, status: o.status, message: notPackableOrderMessage(o.code, o.status) } };
    }
    throw new DomainError("INVALID_STATE", NO_ALLOCATED_ORDER);
  }
  const packedOrders = orders.filter((o) => !o.packable && !(PACKABLE_STATUSES as readonly string[]).includes(o.status)).length;
  return { mode: input.mode, code: input.code, sourceLabel, job: jobOf(db, orders.map((o) => o.id)), orders, totalOrders: orders.length, packedOrders };
}

/** A scan that matched nothing packable: an ordinary operator outcome, answered as 200 (no console error). */
export interface ScanMiss {
  readonly miss: { readonly code: string; readonly message: string; readonly kind: "NOT_FOUND" | "INVALID_STATE"; readonly orderId?: string; readonly orderCode?: string };
}

/**
 * Route wrapper for `resolveScan`: expected scan misses (unknown code, nothing allocated, open
 * pack short) come back as a typed `{ miss }` result instead of a 404/409, so a mis-scan never
 * logs a browser console error. An out-of-scope warehouse still throws (404).
 */
export function scanOutcome(db: AppDb, scope: Scope, input: z.output<typeof scanQuerySchema>): ScanResult | ScanMiss {
  assertWarehouse(scope, input.warehouseId);
  try {
    return resolveScan(db, scope, input);
  } catch (e) {
    if (e instanceof DomainError && (e.code === "NOT_FOUND" || e.code === "INVALID_STATE")) {
      const d = e.details as { orderId?: string; orderCode?: string } | undefined;
      return { miss: { code: input.code, message: e.message, kind: e.code, ...(d?.orderId ? { orderId: d.orderId, orderCode: d.orderCode } : {}) } };
    }
    throw e;
  }
}

/* --------------------------------------------------------- list & select */


export const readyListSchema = z.object({
  warehouseId: warehouseIdParam,
  q: z.string().trim().max(120).optional(),
  clientId: z.string().max(64).optional(),
  jobCode: z.string().trim().max(60).optional(),
  note: z.string().trim().max(120).optional(),
  expectedShipDate: z.string().trim().max(10).optional(),
  stationId: z.string().trim().max(64).optional(),
});

export interface ReadyOrderRow {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly clientName: string;
  readonly customerName: string;
  readonly jobCode: string | null;
  readonly expectedShipDate: string | null;
  readonly note: string | null;
  readonly unitsToPack: number;
  readonly priority: string;
  readonly countLock: PackOrderSummary["countLock"];
}

export function readyToPackOrders(db: AppDb, scope: Scope, input: z.output<typeof readyListSchema>, opts: { readonly locks?: boolean } = {}): ReadyOrderRow[] {
  assertWarehouse(scope, input.warehouseId);
  const parts: SQL[] = [sql`o.warehouse_id = ${input.warehouseId}`, sql`o.status IN ('Ready to Pack', 'Packing Started')`, sql`o.pack_short_status <> 'Open'`, sql`o.deleted_at IS NULL`, clientScope(scope, "o.client_id")];
  if (input.q) parts.push(sql`lower(o.code) LIKE ${`${input.q.toLowerCase()}%`}`);
  if (input.clientId) parts.push(sql`o.client_id = ${input.clientId}`);
  if (input.jobCode) parts.push(sql`lower(j.code) LIKE ${`${input.jobCode.toLowerCase()}%`}`);
  if (input.note) parts.push(sql`lower(COALESCE(o.note, '')) LIKE ${`%${input.note.toLowerCase()}%`}`);
  if (input.expectedShipDate) parts.push(sql`substr(o.expected_ship_date, 1, 10) = ${input.expectedShipDate}`);
  const rows = db.all<Omit<ReadyOrderRow, "unitsToPack" | "countLock">>(sql`SELECT o.id, o.code, o.status, c.name AS clientName, o.customer_name AS customerName, j.code AS jobCode,
      o.expected_ship_date AS expectedShipDate, o.note, o.priority
    FROM shipment_orders o JOIN clients c ON c.id = o.client_id LEFT JOIN jobs j ON j.id = o.job_id
    WHERE ${sql.join(parts, sql` AND `)} ORDER BY o.priority_rank DESC, o.expected_ship_date ASC, o.code ASC LIMIT 500`);
  return rows.map((r) => ({ ...r, unitsToPack: unitsToPack(db, r.id) })).filter((r) => r.unitsToPack > 0)
    .map((r) => ({ ...r, countLock: opts.locks === false ? null : lockSummary(db, r.id, r.code, input.stationId) }));
}
