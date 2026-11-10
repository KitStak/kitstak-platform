/**
 * Mobile Carts repository (M10): grid with status derived from the open job that holds the
 * cart, detail (cells with their current orders), create/edit (cart + cell list), duplicate,
 * guarded delete (only Available carts) and label records (cart and cell barcodes).
 */
import { and, asc, eq, getTableColumns, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import * as s from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import { assignJobToCart, CART_RELEASED_ORDER_STATUSES, releaseCart, type AssignJobResult } from "@/server/domain/mobile-cart-cells";
import type { BulkResult } from "@/server/domain/types";
import { paginate } from "@/server/query/paginate";
import type { GridQuery } from "@/server/query/grid-query";
import { buildCells, cellBarcode, cellDisplayName, MOBILE_CART_FIELDS, MOBILE_CART_SEARCH_FIELDS, MOBILE_CART_SORT_FIELDS, type MobileCartSave } from "@/lib/grid-defs/facility/mobile-carts";
import { assertFound, assertVersion, assertWarehouseInScope, compileGrid, domainCtxOf, duplicateError, listScope, logCreate, logDelete, logUpdate, resolveIds, type Actor, type GridBinding, qc } from "./locations-shared";

const t = s.mobileCarts;
const ENTITY = "mobile_cart";
const OPEN_JOB = sql.raw(`('Pending','Started','In Progress')`);

/** The newest open job holding the cart (by link on the job or the cart's current job). */
const openJobIdSql = sql<string | null>`(SELECT j.id FROM jobs j WHERE (j.mobile_cart_id = ${qc(t.id)} OR j.id = ${qc(t.currentJobId)}) AND j.status IN ${OPEN_JOB} ORDER BY j.created_at DESC LIMIT 1)`;
const jobCodeSql = sql<string | null>`(SELECT j.code FROM jobs j WHERE (j.mobile_cart_id = ${qc(t.id)} OR j.id = ${qc(t.currentJobId)}) AND j.status IN ${OPEN_JOB} ORDER BY j.created_at DESC LIMIT 1)`;
const statusSql = sql<"Available" | "Occupied">`(CASE WHEN EXISTS (SELECT 1 FROM jobs j WHERE (j.mobile_cart_id = ${qc(t.id)} OR j.id = ${qc(t.currentJobId)}) AND j.status IN ${OPEN_JOB}) THEN 'Occupied' ELSE 'Available' END)`;
const taskCountSql = sql<number>`(SELECT COUNT(*) FROM tasks tk JOIN jobs j ON j.id = tk.job_id WHERE (j.mobile_cart_id = ${qc(t.id)} OR j.id = ${qc(t.currentJobId)}) AND j.status IN ${OPEN_JOB} AND tk.status NOT IN ('Completed','Cancelled'))`;
const orderCountSql = sql<number>`(SELECT COUNT(DISTINCT jo.order_id) FROM job_orders jo JOIN jobs j ON j.id = jo.job_id WHERE (j.mobile_cart_id = ${qc(t.id)} OR j.id = ${qc(t.currentJobId)}) AND j.status IN ${OPEN_JOB})`;
const cellCountSql = sql<number>`(SELECT COUNT(*) FROM mobile_cart_cells c WHERE c.cart_id = ${qc(t.id)})`;
const warehouseCodeSql = sql<string>`(SELECT w.code FROM warehouses w WHERE w.id = ${qc(t.warehouseId)})`;
const cartTypeSql = sql<string | null>`(SELECT lv.name FROM lookup_values lv WHERE lv.id = ${qc(t.cartTypeId)})`;

export const MOBILE_CART_SQL: Readonly<Record<string, SQL>> = {
  code: sql`${t.code}`,
  description: sql`${t.description}`,
  warehouseId: sql`${t.warehouseId}`,
  warehouseCode: warehouseCodeSql,
  cartTypeId: sql`${t.cartTypeId}`,
  status: statusSql,
  cellCount: cellCountSql,
  levels: sql`${t.levels}`,
  columns: sql`${t.columns}`,
  taskCount: taskCountSql,
  jobCode: jobCodeSql,
  orderCount: orderCountSql,
  operationType: sql`${t.operationType}`,
  allowMultipleJob: sql`${t.allowMultipleJob}`,
  isDynamic: sql`${t.isDynamic}`,
  createdAt: sql`${t.createdAt}`,
};

const BINDING: GridBinding = {
  exprs: MOBILE_CART_SQL, fields: MOBILE_CART_FIELDS, sortable: MOBILE_CART_SORT_FIELDS, search: MOBILE_CART_SEARCH_FIELDS,
  defaultSort: [{ field: "code", dir: "asc" }], tiebreaker: t.id,
};

export interface MobileCartRow {
  readonly id: string;
  readonly code: string;
  readonly description: string | null;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly cartTypeId: string;
  readonly cartTypeName: string | null;
  readonly status: "Available" | "Occupied";
  readonly cellCount: number;
  readonly levels: number;
  readonly columns: number;
  readonly taskCount: number;
  readonly jobId: string | null;
  readonly jobCode: string | null;
  readonly orderCount: number;
  readonly operationType: "Picking" | "Replenishment";
  readonly allowMultipleJob: boolean;
  readonly isDynamic: boolean;
  readonly createdAt: string;
  readonly version: number;
}

const ROW_SELECT = {
  id: t.id, code: t.code, description: t.description, warehouseId: t.warehouseId, warehouseCode: warehouseCodeSql,
  cartTypeId: t.cartTypeId, cartTypeName: cartTypeSql, status: statusSql, cellCount: cellCountSql, levels: t.levels, columns: t.columns,
  taskCount: taskCountSql, jobId: openJobIdSql, jobCode: jobCodeSql, orderCount: orderCountSql, operationType: t.operationType,
  allowMultipleJob: t.allowMultipleJob, isDynamic: t.isDynamic, createdAt: t.createdAt, version: t.version,
};

const normalize = (r: Record<string, unknown>): MobileCartRow =>
  ({ ...r, allowMultipleJob: Boolean(r.allowMultipleJob), isDynamic: Boolean(r.isDynamic) }) as unknown as MobileCartRow;

export function listMobileCarts(db: AppDb, auth: AuthContext, query: GridQuery): { rows: MobileCartRow[]; total: number } {
  const grid = compileGrid(BINDING, query, [listScope(t, auth)]);
  const result = paginate(
    db.select(ROW_SELECT).from(t).where(grid.where).orderBy(...grid.orderBy).$dynamic(),
    () => db.select({ n: sql<number>`count(*)` }).from(t).where(grid.where).get()?.n ?? 0,
    { page: query.page, pageSize: query.pageSize },
  );
  return { rows: (result.rows as unknown as Record<string, unknown>[]).map(normalize), total: result.total };
}

export function loadMobileCart(db: AppDb, auth: AuthContext, id: string): typeof t.$inferSelect {
  const row = assertFound(db.select().from(t).where(eq(t.id, id)).get(), "Mobile cart");
  assertWarehouseInScope(auth, row.warehouseId, "Mobile cart");
  return row;
}

function cartRow(db: AppDb, id: string): MobileCartRow {
  return normalize(db.select(ROW_SELECT).from(t).where(eq(t.id, id)).get() as unknown as Record<string, unknown>);
}

export function getMobileCart(db: AppDb, auth: AuthContext, id: string) {
  loadMobileCart(db, auth, id);
  const row = cartRow(db, id);
  const cells = db
    .select({ id: s.mobileCartCells.id, level: s.mobileCartCells.level, column: s.mobileCartCells.column, barcode: s.mobileCartCells.barcode, orderCode: s.shipmentOrders.code })
    .from(s.mobileCartCells)
    // A cell whose order already left the cart (packed, shipped, cancelled) reads as free.
    .leftJoin(s.shipmentOrders, and(eq(s.shipmentOrders.id, s.mobileCartCells.orderId), notInArray(s.shipmentOrders.status, [...CART_RELEASED_ORDER_STATUSES])))
    .where(eq(s.mobileCartCells.cartId, id))
    .orderBy(asc(s.mobileCartCells.level), asc(s.mobileCartCells.column))
    .all();
  return { ...row, cells, orders: cartOrders(db, id, cells) };
}

/**
 * Orders the open job(s) on this cart are working (critic R5: an occupied cart showed every cell
 * "Empty" with no order view). The cell comes from the cell's own order link, else from the job's
 * tote/cell scan (matched by barcode); null = not sorted into a cell yet.
 */
function cartOrders(db: AppDb, cartId: string, cells: readonly { readonly barcode: string; readonly orderCode: string | null }[]) {
  const rows = db.all<{ orderId: string; orderCode: string; jobId: string; jobCode: string; toteOrCell: string | null; cellBarcode: string | null; planned: number; picked: number; openTasks: number }>(sql`
    SELECT so.id AS orderId, so.code AS orderCode, j.id AS jobId, j.code AS jobCode, jo.tote_or_cell AS toteOrCell,
      (SELECT c.barcode FROM mobile_cart_cells c WHERE c.cart_id = ${cartId} AND c.order_id = so.id LIMIT 1) AS cellBarcode,
      COALESCE((SELECT SUM(tk.planned_qty) FROM tasks tk WHERE tk.job_id = j.id AND tk.order_id = so.id AND tk.status <> 'Cancelled'), 0) AS planned,
      COALESCE((SELECT SUM(tk.actual_qty) FROM tasks tk WHERE tk.job_id = j.id AND tk.order_id = so.id AND tk.status <> 'Cancelled'), 0) AS picked,
      (SELECT COUNT(*) FROM tasks tk WHERE tk.job_id = j.id AND tk.order_id = so.id AND tk.status NOT IN ('Completed','Cancelled')) AS openTasks
    FROM jobs j
    JOIN job_orders jo ON jo.job_id = j.id
    JOIN shipment_orders so ON so.id = jo.order_id
    WHERE (j.mobile_cart_id = ${cartId} OR j.id = (SELECT current_job_id FROM mobile_carts WHERE id = ${cartId})) AND j.status IN ${OPEN_JOB}
    ORDER BY so.code
    LIMIT 500`);
  const byBarcode = new Set(cells.map((c) => c.barcode.toUpperCase()));
  return rows.map((r) => {
    const scanned = r.toteOrCell && byBarcode.has(r.toteOrCell.toUpperCase()) ? r.toteOrCell.toUpperCase() : null;
    return { ...r, cell: r.cellBarcode ?? scanned, tote: r.toteOrCell && !scanned ? r.toteOrCell : null };
  });
}

export type MobileCartDetail = ReturnType<typeof getMobileCart>;

function assertCartType(db: AppDb, cartTypeId: string, warehouseId: string): void {
  const lv = db.select({ type: s.lookupValues.type, warehouseId: s.lookupValues.warehouseId, isActive: s.lookupValues.isActive }).from(s.lookupValues).where(eq(s.lookupValues.id, cartTypeId)).get();
  if (!lv || lv.type !== "mobile_cart_type" || !lv.isActive || (lv.warehouseId && lv.warehouseId !== warehouseId)) {
    throw new AppError("VALIDATION", "Choose a mobile cart type of this warehouse", { fieldErrors: { cartTypeId: ["Choose a mobile cart type of this warehouse"] } });
  }
}

function assertCodeFree(db: AppDb, warehouseId: string, code: string, exceptId?: string): void {
  const clash = db.select({ id: t.id }).from(t).where(and(eq(t.warehouseId, warehouseId), sql`lower(${t.code}) = lower(${code})`)).get();
  if (clash && clash.id !== exceptId) throw duplicateError("code", `Mobile cart ${code} already exists in this warehouse`);
}

/** Cell barcodes double as scan targets, so they must not collide with another cart's cells or a location. */
function assertCellBarcodesFree(db: AppDb, warehouseId: string, barcodes: readonly string[], exceptCartId?: string): void {
  if (barcodes.length === 0) return;
  const upper = barcodes.map((b) => b.trim().toUpperCase());
  const cellClash = db
    .select({ barcode: s.mobileCartCells.barcode, cart: t.code, cartId: t.id })
    .from(s.mobileCartCells)
    .innerJoin(t, eq(t.id, s.mobileCartCells.cartId))
    .where(and(eq(t.warehouseId, warehouseId), inArray(sql`upper(${s.mobileCartCells.barcode})`, upper)))
    .all()
    .find((r) => r.cartId !== exceptCartId);
  if (cellClash) throw duplicateError("cells", `Cell barcode ${cellClash.barcode} is already used by cart ${cellClash.cart}`);
  const locClash = db.select({ code: s.locations.code }).from(s.locations)
    .where(and(eq(s.locations.warehouseId, warehouseId), inArray(sql`upper(coalesce(${s.locations.barcode}, ${s.locations.code}))`, upper))).get();
  if (locClash) throw duplicateError("cells", `Cell barcode ${locClash.code} is already a location barcode`);
}

function display(db: AppDb, row: typeof t.$inferSelect, cellCount: number): Record<string, unknown> {
  const wh = resolveIds(db, "warehouses", [row.warehouseId]);
  const lv = resolveIds(db, "lookup_values", [row.cartTypeId]);
  return {
    code: row.code, description: row.description, warehouse: wh.get(row.warehouseId) ?? "", cartType: lv.get(row.cartTypeId) ?? "",
    levels: row.levels, columns: row.columns, cellCount, operationType: row.operationType, allowMultipleJob: row.allowMultipleJob, isDynamic: row.isDynamic,
  };
}

function insertCells(tx: AppDb, cartId: string, cells: MobileCartSave["cells"]): void {
  tx.insert(s.mobileCartCells).values(cells.map((c) => ({ cartId, level: c.level, column: c.column, barcode: c.barcode.trim().toUpperCase() }))).run();
}

function columnsFor(input: MobileCartSave) {
  return {
    code: input.code.trim().toUpperCase(), warehouseId: input.warehouseId, description: input.description, cartTypeId: input.cartTypeId,
    levels: input.levels, columns: input.columns, operationType: input.operationType, allowMultipleJob: input.allowMultipleJob, isDynamic: input.isDynamic,
  };
}

export function createMobileCart(tx: AppDb, auth: AuthContext, actor: Actor, input: MobileCartSave): { id: string; code: string } {
  assertWarehouseInScope(auth, input.warehouseId);
  assertCartType(tx, input.cartTypeId, input.warehouseId);
  assertCodeFree(tx, input.warehouseId, input.code.trim());
  assertCellBarcodesFree(tx, input.warehouseId, input.cells.map((c) => c.barcode));
  const row = tx.insert(t).values({ ...columnsFor(input), createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: t.id, code: t.code }).get();
  insertCells(tx, row.id, input.cells);
  logCreate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: row.id, entityCode: row.code });
  return row;
}

const cellsOf = (db: AppDb, cartId: string) =>
  db.select({ level: s.mobileCartCells.level, column: s.mobileCartCells.column, barcode: s.mobileCartCells.barcode }).from(s.mobileCartCells)
    .where(eq(s.mobileCartCells.cartId, cartId)).orderBy(asc(s.mobileCartCells.level), asc(s.mobileCartCells.column)).all();

const sameCells = (a: readonly { level: number; column: number; barcode: string }[], b: readonly { level: number; column: number; barcode: string }[]) =>
  a.length === b.length && a.every((c, i) => c.level === b[i]?.level && c.column === b[i]?.column && c.barcode.toUpperCase() === b[i]?.barcode.trim().toUpperCase());

export function updateMobileCart(tx: AppDb, auth: AuthContext, actor: Actor, id: string, input: MobileCartSave): { id: string; code: string; version: number } {
  const before = loadMobileCart(tx, auth, id);
  assertVersion(before.version, input.version);
  if (input.warehouseId !== before.warehouseId) {
    throw new AppError("VALIDATION", "A mobile cart can't move to another warehouse", { fieldErrors: { warehouseId: ["A mobile cart can't move to another warehouse"] } });
  }
  assertCartType(tx, input.cartTypeId, before.warehouseId);
  assertCodeFree(tx, before.warehouseId, input.code.trim(), id);
  const oldCells = cellsOf(tx, id);
  const sorted = [...input.cells].sort((a, b) => a.level - b.level || a.column - b.column);
  const cellsChanged = !sameCells(oldCells, sorted);
  if (cellsChanged) {
    if (cartRow(tx, id).status === "Occupied") throw new AppError("INVALID_STATE", `${before.code} is in use by an open job; its cells can't change until the job finishes`);
    assertCellBarcodesFree(tx, before.warehouseId, input.cells.map((c) => c.barcode), id);
  }
  const snapshot = display(tx, before, oldCells.length);
  const after = tx.update(t).set({ ...columnsFor(input), updatedBy: actor.userId, version: sql`${t.version} + 1` }).where(eq(t.id, id)).returning().get();
  if (cellsChanged) {
    tx.delete(s.mobileCartCells).where(eq(s.mobileCartCells.cartId, id)).run();
    insertCells(tx, id, input.cells);
  }
  const next = { ...display(tx, after, input.cells.length), cellList: cellsChanged ? "Edited" : "Unchanged" };
  logUpdate(tx, domainCtxOf(actor, auth), { entityType: ENTITY, entityId: id, entityCode: after.code }, { ...snapshot, cellList: "Unchanged" }, next);
  return { id, code: after.code, version: after.version };
}

/** Copies the cart with a new code; cell barcodes are re-derived from the new code. */
export function duplicateMobileCart(tx: AppDb, auth: AuthContext, actor: Actor, id: string, code: string): { id: string; code: string } {
  const source = loadMobileCart(tx, auth, id);
  const nextCode = code.trim().toUpperCase();
  const oldPrefix = source.code.toUpperCase();
  const cells = cellsOf(tx, id).map((c) => ({
    level: c.level, column: c.column,
    barcode: c.barcode.toUpperCase().startsWith(oldPrefix) ? `${nextCode}${c.barcode.slice(oldPrefix.length)}`.toUpperCase() : cellBarcode(nextCode, c.level, c.column),
  }));
  return createMobileCart(tx, auth, actor, {
    code: nextCode, warehouseId: source.warehouseId, description: source.description, cartTypeId: source.cartTypeId, levels: source.levels, columns: source.columns,
    operationType: source.operationType, allowMultipleJob: source.allowMultipleJob, isDynamic: source.isDynamic,
    cells: cells.length ? cells : buildCells(nextCode, source.levels, source.columns), version: undefined,
  });
}

/** Why a cart can't be deleted, or null. */
export function mobileCartDeleteBlocker(db: AppDb, id: string): string | null {
  const row = cartRow(db, id);
  return row.status === "Occupied" ? `is in use by job ${row.jobCode ?? ""}`.trim() : null;
}

export function deleteMobileCarts(tx: AppDb, auth: AuthContext, actor: Actor, ids: readonly string[]): BulkResult {
  const ctx = domainCtxOf(actor, auth);
  return runBulk(tx, ids, (inner, id) => {
    const row = loadMobileCart(inner, auth, id);
    const reason = mobileCartDeleteBlocker(inner, id);
    if (reason) throw new AppError("INVALID_STATE", `${row.code} ${reason}; only Available carts can be deleted`);
    const referenced = inner.select({ n: sql<number>`count(*)` }).from(s.jobs).where(eq(s.jobs.mobileCartId, id)).get()?.n ?? 0;
    if (referenced > 0) inner.update(s.jobs).set({ mobileCartId: null }).where(eq(s.jobs.mobileCartId, id)).run();
    inner.delete(t).where(eq(t.id, id)).run();
    logDelete(inner, ctx, { entityType: ENTITY, entityId: id, entityCode: row.code, warehouseId: row.warehouseId });
  });
}

export interface CartLabelRecord {
  readonly code: string;
  readonly name?: string;
  readonly cartType?: string;
}

/** `mobile-cart-label` records: the cart itself, then (optionally) every cell, level-major. */
export function mobileCartLabelRecords(db: AppDb, auth: AuthContext, ids: readonly string[], include: "carts" | "cells" | "both"): CartLabelRecord[] {
  const carts = db.select({ id: t.id, code: t.code, description: t.description, cartType: cartTypeSql }).from(t)
    .where(and(inArray(t.id, [...ids]), listScope(t, auth))).orderBy(asc(t.code)).all();
  if (carts.length === 0) throw new AppError("NOT_FOUND", "None of the selected mobile carts were found");
  const out: CartLabelRecord[] = [];
  for (const cart of carts) {
    if (include !== "cells") out.push({ code: cart.code, ...(cart.description ? { name: cart.description } : {}), ...(cart.cartType ? { cartType: cart.cartType } : {}) });
    if (include === "carts") continue;
    for (const cell of cellsOf(db, cart.id)) {
      out.push({ code: cell.barcode, name: `${cart.code} · Cell ${cellDisplayName(cell.level, cell.column)}`, ...(cart.cartType ? { cartType: cart.cartType } : {}) });
    }
  }
  return out;
}

/** Re-exported for the export provider and tests. */
export const MOBILE_CART_COLUMNS = getTableColumns(t);

/* ---------------- put-to-cart (REQ-R10-6) ---------------- */

/** Open picking jobs of the cart's warehouse that could take this cart (for the drawer's Assign job picker). */
export function cartJobCandidates(db: AppDb, auth: AuthContext, cartId: string) {
  const cart = loadMobileCart(db, auth, cartId);
  return db.all<{ id: string; code: string; status: string; jobType: string | null; orderCount: number; cartCode: string | null }>(sql`
    SELECT j.id, j.code, j.status, j.job_type AS jobType,
      (SELECT COUNT(*) FROM job_orders jo WHERE jo.job_id = j.id) AS orderCount,
      (SELECT m.code FROM mobile_carts m WHERE m.id = j.mobile_cart_id) AS cartCode
    FROM jobs j
    WHERE j.warehouse_id = ${cart.warehouseId} AND j.operation_type = 'Picking' AND j.status IN ${OPEN_JOB}
      AND (j.mobile_cart_id IS NULL OR j.mobile_cart_id = ${cart.id})
    ORDER BY j.created_at DESC
    LIMIT 100`);
}

/** Puts an open picking job on the cart; each order gets a cell (domain `assignJobToCart`). */
export function assignCartJob(db: AppDb, auth: AuthContext, actor: Actor, cartId: string, jobId: string): AssignJobResult {
  const cart = loadMobileCart(db, auth, cartId);
  const job = db.select({ warehouseId: s.jobs.warehouseId }).from(s.jobs).where(eq(s.jobs.id, jobId)).get();
  if (!job) throw new AppError("NOT_FOUND", "Job not found");
  assertWarehouseInScope(auth, job.warehouseId, "Job");
  return assignJobToCart(db, domainCtxOf(actor, auth), { cartId: cart.id, jobId });
}

/** Empties the cart: frees every cell and unlinks its open jobs. */
export function releaseMobileCart(db: AppDb, auth: AuthContext, actor: Actor, cartId: string) {
  const cart = loadMobileCart(db, auth, cartId);
  return releaseCart(db, domainCtxOf(actor, auth), cart.id);
}
