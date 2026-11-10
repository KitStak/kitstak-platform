/**
 * Put-to-cart cell assignment (REQ-R10-6, blind judge J1): when a picking job takes a mobile cart,
 * each of its orders gets one cell, in suggestion sequence (level A first, column 01 first). The
 * link is written on both sides: `mobile_cart_cells.order_id` (what the cart drawer, packing's
 * cart scan and the cart-layout print read) and `job_orders.tote_or_cell` (the cell barcode the
 * picker scans). Cells whose order already left the cart (packed, shipped, cancelled) are reclaimed.
 */
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { cellDisplayName } from "@/lib/grid-defs/facility/mobile-carts";
import { recordUpdate } from "./change-log";
import { DomainError } from "./errors";
import type { DomainCtx, Tx } from "./types";

const OPEN_JOB_STATUSES = ["Pending", "Started", "In Progress"] as const;
/** Orders in these states are no longer on a cart: their cell is free again. */
export const CART_RELEASED_ORDER_STATUSES = ["Ready to Ship", "Shipped", "Delivered", "Cancelled"] as const;

export interface CellAssignment {
  readonly orderId: string;
  readonly orderCode: string;
  readonly cellId: string;
  /** Scan value, e.g. MC-01-A01. */
  readonly barcode: string;
  /** Operator-facing name, e.g. A01. */
  readonly display: string;
}

export interface AssignJobResult {
  readonly cartId: string;
  readonly cartCode: string;
  readonly jobId: string;
  readonly jobCode: string;
  readonly assignments: readonly CellAssignment[];
}

/**
 * Pairs orders with free cells in suggestion order. PURE: `cells` must already be sorted by
 * level then column; orders keep their given order. Returns null when there aren't enough cells.
 */
export function planCellAssignments<O extends { readonly id: string }, C extends { readonly id: string }>(orders: readonly O[], freeCells: readonly C[]): readonly { readonly order: O; readonly cell: C }[] | null {
  if (orders.length > freeCells.length) return null;
  return orders.map((order, i) => ({ order, cell: freeCells[i] as C }));
}

/** Frees cells whose order has left the cart (packed, shipped, cancelled or deleted). Returns how many. */
export function reclaimCartCells(tx: Tx, cartId: string): number {
  const held = tx.select({ id: schema.mobileCartCells.id, orderId: schema.mobileCartCells.orderId, barcode: schema.mobileCartCells.barcode })
    .from(schema.mobileCartCells).where(and(eq(schema.mobileCartCells.cartId, cartId), isNotNull(schema.mobileCartCells.orderId))).all();
  if (held.length === 0) return 0;
  const live = new Set(tx.select({ id: schema.shipmentOrders.id, status: schema.shipmentOrders.status }).from(schema.shipmentOrders)
    .where(inArray(schema.shipmentOrders.id, held.map((h) => h.orderId as string))).all()
    .filter((o) => !(CART_RELEASED_ORDER_STATUSES as readonly string[]).includes(o.status)).map((o) => o.id));
  const stale = held.filter((h) => !live.has(h.orderId as string));
  for (const h of stale) tx.update(schema.mobileCartCells).set({ orderId: null }).where(eq(schema.mobileCartCells.id, h.id)).run();
  return stale.length;
}

function loadCart(tx: Tx, cartId: string) {
  const cart = tx.select().from(schema.mobileCarts).where(eq(schema.mobileCarts.id, cartId)).get();
  if (!cart) throw new DomainError("NOT_FOUND", "Mobile cart not found");
  return cart;
}

/** Open jobs currently holding the cart (linked on the job, or the cart's current job). */
function openJobsOnCart(tx: Tx, cart: { readonly id: string; readonly currentJobId: string | null }) {
  return tx.select({ id: schema.jobs.id, code: schema.jobs.code }).from(schema.jobs)
    .where(and(inArray(schema.jobs.status, [...OPEN_JOB_STATUSES]), cart.currentJobId
      ? sql`(${schema.jobs.mobileCartId} = ${cart.id} OR ${schema.jobs.id} = ${cart.currentJobId})`
      : eq(schema.jobs.mobileCartId, cart.id))).all();
}

/** Puts an open picking job on a cart and gives each of its orders a cell. */
export function assignJobToCart(tx: Tx, ctx: DomainCtx, input: { readonly cartId: string; readonly jobId: string }): AssignJobResult {
  const cart = loadCart(tx, input.cartId);
  const job = tx.select().from(schema.jobs).where(eq(schema.jobs.id, input.jobId)).get();
  if (!job) throw new DomainError("NOT_FOUND", "Job not found");
  if (job.warehouseId !== cart.warehouseId) throw new DomainError("VALIDATION", `Job ${job.code} is in another warehouse than cart ${cart.code}`);
  if (!(OPEN_JOB_STATUSES as readonly string[]).includes(job.status)) throw new DomainError("INVALID_STATE", `Job ${job.code} is ${job.status}; only an open job can take a cart`);
  if (job.operationType !== "Picking") throw new DomainError("VALIDATION", `Job ${job.code} is a ${job.operationType} job; carts take picking jobs`);
  if (job.mobileCartId && job.mobileCartId !== cart.id) {
    const other = tx.select({ code: schema.mobileCarts.code }).from(schema.mobileCarts).where(eq(schema.mobileCarts.id, job.mobileCartId)).get();
    throw new DomainError("CONFLICT", `Job ${job.code} already uses cart ${other?.code ?? "another cart"}`);
  }
  const busy = openJobsOnCart(tx, cart).filter((j) => j.id !== job.id);
  if (busy.length > 0 && !cart.allowMultipleJob) throw new DomainError("CONFLICT", `Cart ${cart.code} is in use by ${busy.map((j) => j.code).join(", ")}; it doesn't allow multiple jobs`);

  reclaimCartCells(tx, cart.id);
  const cells = tx.select().from(schema.mobileCartCells).where(eq(schema.mobileCartCells.cartId, cart.id))
    .orderBy(asc(schema.mobileCartCells.level), asc(schema.mobileCartCells.column)).all();
  const placed = new Set(cells.flatMap((c) => (c.orderId ? [c.orderId] : [])));
  const orders = tx.select({ id: schema.shipmentOrders.id, code: schema.shipmentOrders.code }).from(schema.jobOrders)
    .innerJoin(schema.shipmentOrders, eq(schema.shipmentOrders.id, schema.jobOrders.orderId))
    .where(eq(schema.jobOrders.jobId, job.id)).orderBy(asc(schema.shipmentOrders.code)).all()
    .filter((o) => !placed.has(o.id));
  const free = cells.filter((c) => !c.orderId);
  const plan = planCellAssignments(orders, free);
  if (!plan) throw new DomainError("VALIDATION", `Job ${job.code} has ${orders.length} orders but cart ${cart.code} has only ${free.length} free cells`);

  const assignments: CellAssignment[] = [];
  for (const { order, cell } of plan) {
    tx.update(schema.mobileCartCells).set({ orderId: order.id }).where(eq(schema.mobileCartCells.id, cell.id)).run();
    tx.update(schema.jobOrders).set({ toteOrCell: cell.barcode }).where(and(eq(schema.jobOrders.jobId, job.id), eq(schema.jobOrders.orderId, order.id))).run();
    assignments.push({ orderId: order.id, orderCode: order.code, cellId: cell.id, barcode: cell.barcode, display: cellDisplayName(cell.level, cell.column) });
  }
  const linkChanged = job.mobileCartId !== cart.id;
  if (linkChanged) tx.update(schema.jobs).set({ mobileCartId: cart.id, updatedBy: ctx.userId }).where(eq(schema.jobs.id, job.id)).run();
  const priorJob = cart.currentJobId ? tx.select({ code: schema.jobs.code }).from(schema.jobs).where(eq(schema.jobs.id, cart.currentJobId)).get()?.code ?? null : null;
  tx.update(schema.mobileCarts).set({ currentJobId: job.id, status: "Occupied", updatedBy: ctx.userId }).where(eq(schema.mobileCarts.id, cart.id)).run();
  if (priorJob !== job.code || assignments.length > 0) {
    recordUpdate(tx, ctx, { entityType: "mobile_cart", entityId: cart.id, entityCode: cart.code,
      before: { currentJob: priorJob, ordersInCells: null }, after: { currentJob: job.code, ordersInCells: assignments.length > 0 ? assignments.map((a) => `${a.orderCode} → ${a.display}`).join(", ") : null } });
  }
  if (linkChanged) recordUpdate(tx, ctx, { entityType: "job", entityId: job.id, entityCode: job.code, before: { mobileCart: null }, after: { mobileCart: cart.code } });
  return { cartId: cart.id, cartCode: cart.code, jobId: job.id, jobCode: job.code, assignments };
}

/** Empties the cart: clears every cell, unlinks its open jobs and makes it Available. Returns the cells freed. */
export function releaseCart(tx: Tx, ctx: DomainCtx, cartId: string): { readonly cartCode: string; readonly freedCells: number; readonly releasedJobs: readonly string[] } {
  const cart = loadCart(tx, cartId);
  const held = tx.select({ id: schema.mobileCartCells.id, barcode: schema.mobileCartCells.barcode, orderId: schema.mobileCartCells.orderId }).from(schema.mobileCartCells)
    .where(and(eq(schema.mobileCartCells.cartId, cart.id), isNotNull(schema.mobileCartCells.orderId))).all();
  const jobs = openJobsOnCart(tx, cart);
  tx.update(schema.mobileCartCells).set({ orderId: null }).where(eq(schema.mobileCartCells.cartId, cart.id)).run();
  // Every cell barcode of this cart, so links of orders reclaimed earlier are cleared too.
  const barcodes = tx.select({ b: schema.mobileCartCells.barcode }).from(schema.mobileCartCells).where(eq(schema.mobileCartCells.cartId, cart.id)).all().map((c) => c.b);
  if (barcodes.length > 0) tx.update(schema.jobOrders).set({ toteOrCell: null }).where(inArray(schema.jobOrders.toteOrCell, barcodes)).run();
  for (const j of jobs) {
    tx.update(schema.jobs).set({ mobileCartId: null, updatedBy: ctx.userId }).where(and(eq(schema.jobs.id, j.id), eq(schema.jobs.mobileCartId, cart.id))).run();
  }
  tx.update(schema.mobileCarts).set({ currentJobId: null, status: "Available", updatedBy: ctx.userId }).where(eq(schema.mobileCarts.id, cart.id)).run();
  if (held.length > 0 || jobs.length > 0) {
    recordUpdate(tx, ctx, { entityType: "mobile_cart", entityId: cart.id, entityCode: cart.code,
      before: { currentJob: jobs.map((j) => j.code).join(", ") || null, ordersInCells: held.length > 0 ? `${held.length} cells` : null }, after: { currentJob: null, ordersInCells: null } });
  }
  return { cartCode: cart.code, freedCells: held.length, releasedJobs: jobs.map((j) => j.code) };
}
