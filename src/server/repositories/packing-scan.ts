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
}

export function packingStations(db: AppDb, scope: Scope, warehouseId: string): PackingStation[] {
  assertWarehouse(scope, warehouseId);
  return db.select({ id: schema.locations.id, code: schema.locations.code, warehouseId: schema.locations.warehouseId, description: schema.locations.displayMember })
    .from(schema.locations)
    .where(and(eq(schema.locations.warehouseId, warehouseId), eq(schema.locations.areaType, "Packing"), eq(schema.locations.isActive, true)))
    .orderBy(schema.locations.code).all();
}

export function loadStation(db: AppDb, scope: Scope, stationId: string): PackingStation {
  const loc = db.select().from(schema.locations).where(eq(schema.locations.id, stationId)).get();
  if (!loc || !hasWarehouse(scope, loc.warehouseId)) throw new DomainError("NOT_FOUND", "Packing station not found");
  if (loc.areaType !== "Packing") throw new DomainError("VALIDATION", `${loc.code} is not a packing station.`);
  return { id: loc.id, code: loc.code, warehouseId: loc.warehouseId, description: loc.displayMember };
}

/* ------------------------------------------------------------------- KPIs */

export interface PackingKpis {
  readonly ordersPackedToday: number;
  readonly productsPackedToday: number;
  readonly ordersToPack: number;
}

export function packingKpis(db: AppDb, scope: Scope, warehouseId: string, userId: string | null, now = new Date()): PackingKpis {
  assertWarehouse(scope, warehouseId);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const since = start.toISOString();
  const mine = db.get<{ orders: number; units: number }>(sql`SELECT COUNT(DISTINCT order_id) AS orders, COALESCE(SUM(actual_qty), 0) AS units FROM tasks
    WHERE task_type = 'Packing' AND status = 'Completed' AND warehouse_id = ${warehouseId} AND executed_by_user_id = ${userId ?? ""} AND finished_at >= ${since}`);
  const toPack = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipment_orders WHERE warehouse_id = ${warehouseId}
    AND status IN ('Ready to Pack', 'Packing Started') AND deleted_at IS NULL AND ${clientScope(scope, "client_id")}`);
  return { ordersPackedToday: mine?.orders ?? 0, productsPackedToday: mine?.units ?? 0, ordersToPack: toPack?.n ?? 0 };
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
}

export interface ScanResult {
  readonly mode: PackMode;
  readonly code: string;
  readonly sourceLabel: string;
  readonly job: { readonly id: string; readonly code: string; readonly jobType: string } | null;
  readonly orders: readonly PackOrderSummary[];
  readonly totalOrders: number;
  readonly packedOrders: number;
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

function summarize(db: AppDb, scope: Scope, warehouseId: string, ids: readonly string[]): PackOrderSummary[] {
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
    };
  }).sort((a, b) => Number(b.packable) - Number(a.packable) || a.code.localeCompare(b.code));
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

export const scanQuerySchema = z.object({
  warehouseId: z.string().min(1).max(64),
  mode: z.enum(PACK_MODES),
  code: z.string().trim().min(1, "Scan or enter a code").max(120),
});

export function resolveScan(db: AppDb, scope: Scope, input: z.output<typeof scanQuerySchema>): ScanResult {
  assertWarehouse(scope, input.warehouseId);
  const lc = input.code.trim().toLowerCase();
  let ids: string[] = [];
  let sourceLabel = input.code;
  if (input.mode === "order") {
    ids = db.all<{ id: string }>(sql`SELECT id FROM shipment_orders WHERE warehouse_id = ${input.warehouseId} AND deleted_at IS NULL
      AND (lower(code) = ${lc} OR lower(store_order_number) = ${lc} OR lower(tracking_number) = ${lc}) LIMIT 20`).map((r) => r.id);
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
  const orders = summarize(db, scope, input.warehouseId, ids);
  if (!orders.some((o) => o.packable)) {
    const short = orders.find((o) => o.packShortStatus === "Open" && (PACKABLE_STATUSES as readonly string[]).includes(o.status));
    throw new DomainError("INVALID_STATE", short ? `${short.code} has an open pack short issue. Resolve the pack short on the order before packing it.` : NO_ALLOCATED_ORDER);
  }
  const packedOrders = orders.filter((o) => !o.packable && !(PACKABLE_STATUSES as readonly string[]).includes(o.status)).length;
  return { mode: input.mode, code: input.code, sourceLabel, job: jobOf(db, orders.map((o) => o.id)), orders, totalOrders: orders.length, packedOrders };
}

/* --------------------------------------------------------- list & select */

export const readyListSchema = z.object({
  warehouseId: z.string().min(1).max(64),
  q: z.string().trim().max(120).optional(),
  clientId: z.string().max(64).optional(),
  jobCode: z.string().trim().max(60).optional(),
  note: z.string().trim().max(120).optional(),
  expectedShipDate: z.string().trim().max(10).optional(),
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
}

export function readyToPackOrders(db: AppDb, scope: Scope, input: z.output<typeof readyListSchema>): ReadyOrderRow[] {
  assertWarehouse(scope, input.warehouseId);
  const parts: SQL[] = [sql`o.warehouse_id = ${input.warehouseId}`, sql`o.status IN ('Ready to Pack', 'Packing Started')`, sql`o.pack_short_status <> 'Open'`, sql`o.deleted_at IS NULL`, clientScope(scope, "o.client_id")];
  if (input.q) parts.push(sql`lower(o.code) LIKE ${`${input.q.toLowerCase()}%`}`);
  if (input.clientId) parts.push(sql`o.client_id = ${input.clientId}`);
  if (input.jobCode) parts.push(sql`lower(j.code) LIKE ${`${input.jobCode.toLowerCase()}%`}`);
  if (input.note) parts.push(sql`lower(COALESCE(o.note, '')) LIKE ${`%${input.note.toLowerCase()}%`}`);
  if (input.expectedShipDate) parts.push(sql`substr(o.expected_ship_date, 1, 10) = ${input.expectedShipDate}`);
  const rows = db.all<Omit<ReadyOrderRow, "unitsToPack">>(sql`SELECT o.id, o.code, o.status, c.name AS clientName, o.customer_name AS customerName, j.code AS jobCode,
      o.expected_ship_date AS expectedShipDate, o.note, o.priority
    FROM shipment_orders o JOIN clients c ON c.id = o.client_id LEFT JOIN jobs j ON j.id = o.job_id
    WHERE ${sql.join(parts, sql` AND `)} ORDER BY o.priority_rank DESC, o.expected_ship_date ASC, o.code ASC LIMIT 500`);
  return rows.map((r) => ({ ...r, unitsToPack: unitsToPack(db, r.id) })).filter((r) => r.unitsToPack > 0);
}
