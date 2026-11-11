/**
 * Putaway worklist (M05): received stock still sitting in a receiving location (area type
 * Receiving, legacy role Receiving, or the warehouse default receiving location). Each row
 * is one inventory bucket. Confirm moves the bucket (or part of it, or its whole LP) to a
 * scanned location through the inventory transfer commands, so the ledger records a normal
 * transfer with note "Putaway". The list speaks the grid grammar (filters, sort, paging,
 * export) like every other M05 list.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  PUTAWAY_GRID_FIELDS, PUTAWAY_SEARCH_FIELDS, PUTAWAY_SORT_FIELDS, type PutawayTaskRow,
} from "@/lib/grid-defs/receiving/putaway";
import type { AppDb } from "@/server/api/db";
import { notFoundError, validationError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { scopedWhere } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import { countLockFor, countLockMessage, notCountLocked } from "@/server/domain/ledger/count-locks";
import { suggestLocations } from "@/server/domain/putaway";
import type { BulkResult, DomainCtx } from "@/server/domain/types";
import type { GridQuery } from "@/server/query/grid-query";
import { transferLp, transferProduct, type TransferResult } from "./inventory-commands";
import { compileGrid, type GridSpec } from "./purchase-orders-grid";
import { mapSeq } from "@/server/db/sql";

export type { PutawayTaskRow } from "@/lib/grid-defs/receiving/putaway";

const inv = schema.inventory;
const loc = schema.locations;
const p = schema.products;

const RECEIVING_LOCATION_SQL = sql`(${loc.areaType} = 'Receiving' OR ${loc.type} = 'Receiving'
  OR ${loc.id} IN (SELECT w.default_receiving_location_id FROM warehouses w WHERE w.default_receiving_location_id IS NOT NULL))`;

const sub = (q: SQL): SQL => sql`(${q})`;
const LOCKED_SQL = sql`(CASE WHEN ${loc.isLocked} = true OR NOT ${notCountLocked(inv.locationId)} THEN 1 ELSE 0 END)`;
const DWELL_SQL = sql`trunc(GREATEST(0, ROUND((EXTRACT(EPOCH FROM (now() - (${inv.receivedAt})::timestamptz)) / 3600.0::float8)::numeric)))::int`;

const EXPRS: Readonly<Record<string, SQL>> = {
  warehouseId: sql`${inv.warehouseId}`,
  warehouseName: sub(sql`SELECT w.name FROM warehouses w WHERE w.id = ${inv.warehouseId}`),
  clientId: sql`${inv.clientId}`,
  clientName: sub(sql`SELECT c.name FROM clients c WHERE c.id = ${inv.clientId}`),
  sku: sql`${p.sku}`,
  productName: sql`${p.name}`,
  barcode: sql`${p.barcode}`,
  fromLocationCode: sql`${loc.code}`,
  qty: sql`${inv.onHand}`,
  packType: sql`${inv.packType}`,
  lotNumber: sql`${inv.lotNumber}`,
  expiryDate: sql`${inv.expiryDate}`,
  lpNumber: sub(sql`SELECT lp.number FROM license_plates lp WHERE lp.id = ${inv.lpId}`),
  poNumber: sql`${inv.poNumber}`,
  receivedAt: sql`${inv.receivedAt}`,
  dwellHours: DWELL_SQL,
  locked: LOCKED_SQL,
};

const SPEC: GridSpec = {
  fields: PUTAWAY_GRID_FIELDS,
  sortFields: PUTAWAY_SORT_FIELDS,
  searchFields: PUTAWAY_SEARCH_FIELDS,
  exprs: EXPRS,
  // Oldest first: the stock waiting longest is put away first.
  defaultOrder: [sql`${inv.receivedAt} ASC`, sql`${inv.onHand} DESC`, sql`${inv.id} ASC`],
};

const SELECT = {
  id: inv.id, version: inv.version, warehouseId: inv.warehouseId,
  warehouseName: sql<string>`COALESCE(${EXPRS.warehouseName}, '')`,
  warehouseTimeZone: sql<string>`COALESCE((SELECT w.timezone FROM warehouses w WHERE w.id = ${inv.warehouseId}), 'UTC')`,
  productId: inv.productId, sku: p.sku, productName: p.name, barcode: p.barcode,
  clientId: inv.clientId, clientName: sql<string>`COALESCE(${EXPRS.clientName}, '')`,
  fromLocationId: inv.locationId, fromLocationCode: loc.code, locationLocked: loc.isLocked,
  onHand: inv.onHand, allocated: inv.allocated, damaged: inv.damaged,
  packType: inv.packType, lotNumber: inv.lotNumber, expiryDate: inv.expiryDate,
  lpId: inv.lpId, lpNumber: sql<string | null>`${EXPRS.lpNumber}`,
  poNumber: inv.poNumber,
  purchaseOrderId: sql<string | null>`(SELECT po.id FROM purchase_orders po WHERE po.code = ${inv.poNumber} AND po.warehouse_id = ${inv.warehouseId} LIMIT 1)`,
  receivedAt: inv.receivedAt,
  dwellHours: sql<number>`${DWELL_SQL}`,
};

/** Why a bucket in `location` can't be moved now (manual lock or an open count plan), or null. */
export async function moveBlockedReason(db: AppDb, location: { readonly id: string; readonly code: string; readonly isLocked: boolean }): Promise<string | null> {
  if (location.isLocked) return `Location ${location.code} is locked. Unlock it in Locations before putting stock away.`;
  const plan = await countLockFor(db, location.id);
  return plan ? countLockMessage(location.code, plan) : null;
}

export async function listPutawayTasks(db: AppDb, auth: AuthContext, query: GridQuery): Promise<{ rows: PutawayTaskRow[]; total: number; units: number }> {
  const base = [scopedWhere(inv, auth.viewScope), sql`${inv.onHand} > 0`, eq(inv.status, "Stock"), RECEIVING_LOCATION_SQL];
  const { where, orderBy } = compileGrid(SPEC, query, base);
  const agg = (await db.select({ n: sql<number>`count(*)`, units: sql<number>`COALESCE(SUM(${inv.onHand}), 0)` })
    .from(inv).innerJoin(loc, eq(loc.id, inv.locationId)).innerJoin(p, eq(p.id, inv.productId)).where(where).limit(1))[0];
  const raw = await db.select(SELECT).from(inv).innerJoin(loc, eq(loc.id, inv.locationId)).innerJoin(p, eq(p.id, inv.productId))
    .where(where).orderBy(...orderBy).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
  // One lock lookup per distinct location (a page usually spans a handful of receiving locations).
  const lockByLocation = new Map<string, string | null>();
  const rows = await mapSeq(raw, async ({ onHand, allocated, damaged, locationLocked, ...r }): Promise<PutawayTaskRow> => {
    if (!lockByLocation.has(r.fromLocationId)) {
      lockByLocation.set(r.fromLocationId, await moveBlockedReason(db, { id: r.fromLocationId, code: r.fromLocationCode, isLocked: Boolean(locationLocked) }));
    }
    return {
      ...r, qty: onHand, available: Math.max(0, onHand - allocated - damaged), dwellHours: Number(r.dwellHours) || 0,
      blockedReason: lockByLocation.get(r.fromLocationId) ?? null,
    };
  });
  return { rows, total: agg?.n ?? 0, units: agg?.units ?? 0 };
}

async function bucketInScope(db: AppDb, auth: AuthContext, id: string) {
  const row = (await db.select().from(inv).where(and(eq(inv.id, id), scopedWhere(inv, auth.scope))).limit(1))[0];
  if (!row) throw notFoundError("Putaway task");
  return row;
}

export async function suggestPutaway(db: AppDb, auth: AuthContext, inventoryId: string) {
  const b = await bucketInScope(db, auth, inventoryId);
  try {
    const r = await suggestLocations(db, {
      warehouseId: b.warehouseId, productId: b.productId, qty: Math.max(1, b.onHand), packType: b.packType, lot: b.lotNumber, expiry: b.expiryDate,
      productionDate: b.productionDate, damageReason: b.damageReason, isReceiving: false, fromLocationId: b.locationId, receivedAt: b.receivedAt, limit: 5,
    });
    return { algorithm: r.algorithm, rule: r.rule, suggestions: r.suggestions };
  } catch {
    return { algorithm: null, rule: null, suggestions: [] };
  }
}

export const confirmPutawaySchema = z.object({
  inventoryId: z.string({ message: "Choose the stock to put away" }).trim().min(1, "Choose the stock to put away").max(64),
  /** Scanned or typed location code or barcode (case-insensitive). */
  locationCode: z.string({ message: "Scan or enter a location" }).trim().min(1, "Scan or enter a location").max(80),
  /** Required unless `wholeLp` moves the LP with everything on it. */
  qty: z.number({ message: "Enter a quantity" }).int("Use a whole number").min(1, "Enter a quantity of at least 1").optional(),
  /** Move the bucket's whole LP (every SKU on it) in one scan. */
  wholeLp: z.boolean().optional(),
  version: z.number().int().min(1).optional(),
}).superRefine((v, ctx) => {
  if (!v.wholeLp && v.qty === undefined) ctx.addIssue({ code: "custom", path: ["qty"], message: "Enter a quantity" });
});

async function resolveTarget(db: AppDb, warehouseId: string, code: string, currentLocationId: string): Promise<{ id: string; code: string }> {
  const needle = code.trim().toLowerCase();
  const target = (await db.select({ id: loc.id, code: loc.code }).from(loc).where(and(eq(loc.warehouseId, warehouseId), sql`lower(${loc.code}) = ${needle}`)).limit(1))[0]
    ?? (await db.select({ id: loc.id, code: loc.code }).from(loc).where(and(eq(loc.warehouseId, warehouseId), sql`lower(coalesce(${loc.barcode}, '')) = ${needle}`)).limit(1))[0];
  if (!target) throw validationError(`Location "${code.trim()}" doesn't exist in this warehouse.`, { locationCode: ["Unknown location"] });
  if (target.id === currentLocationId) throw validationError("Scan a storage location, not the receiving location the stock is in.", { locationCode: ["Same as the current location"] });
  return target;
}

async function assertMovable(db: AppDb, locationId: string): Promise<void> {
  const source = (await db.select({ id: loc.id, code: loc.code, isLocked: loc.isLocked }).from(loc).where(eq(loc.id, locationId)).limit(1))[0];
  const reason = source ? await moveBlockedReason(db, { ...source, isLocked: Boolean(source.isLocked) }) : null;
  if (reason) throw validationError(reason, { locationCode: [reason] });
}

export async function confirmPutaway(db: AppDb, auth: AuthContext, ctx: DomainCtx, input: z.infer<typeof confirmPutawaySchema>): Promise<TransferResult & { readonly locationCode: string }> {
  const b = await bucketInScope(db, auth, input.inventoryId);
  await assertMovable(db, b.locationId);
  const target = await resolveTarget(db, b.warehouseId, input.locationCode, b.locationId);
  if (input.wholeLp) {
    if (!b.lpId) throw validationError("This stock is not on an LP. Enter a quantity instead.", { wholeLp: ["Not on an LP"] });
    if (input.version !== undefined && input.version !== b.version) throw validationError("This stock changed since the list loaded. Refresh and try again.", { version: ["Stale"] });
    return { ...(await transferLp(db, ctx, { lpId: b.lpId, target: { kind: "location", id: target.id }, note: "Putaway" })), locationCode: target.code };
  }
  const result = await transferProduct(db, ctx, { inventoryId: b.id, qty: input.qty ?? b.onHand, target: { kind: "location", id: target.id }, version: input.version, note: "Putaway" });
  return { ...result, locationCode: target.code };
}

/* ----------------------------------------------------------------- bulk putaway */

export const bulkPutawaySchema = z.object({
  items: z.array(z.object({ inventoryId: z.string().trim().min(1).max(64), version: z.number().int().min(1).optional() }))
    .min(1, "Select at least one task").max(500, "At most 500 tasks can be put away at once"),
  /** One destination for every selected task; omitted = each task goes to its top suggested location. */
  locationCode: z.string().trim().max(80).optional(),
});

export interface BulkPutawayResult extends BulkResult {
  readonly moved: readonly { readonly id: string; readonly sku: string; readonly qty: number; readonly from: string; readonly to: string }[];
}

/** Puts every selected bucket away in full: to the scanned location, or to its own top suggestion. Each task runs in its own savepoint. */
export async function bulkPutaway(db: AppDb, auth: AuthContext, ctx: DomainCtx, input: z.infer<typeof bulkPutawaySchema>): Promise<BulkPutawayResult> {
  const versions = new Map(input.items.map((i) => [i.inventoryId, i.version]));
  const moved: { id: string; sku: string; qty: number; from: string; to: string }[] = [];
  const code = input.locationCode?.trim() || null;
  const result = await runBulk(db, input.items.map((i) => i.inventoryId), async (tx, id) => {
    const b = await bucketInScope(tx, auth, id);
    let target = code;
    if (!target) {
      const top = (await suggestPutaway(tx, auth, id)).suggestions[0];
      if (!top) throw validationError("No location matched the putaway rules. Put it away one by one and scan a location.");
      target = top.code;
    }
    const from = (await tx.select({ code: loc.code }).from(loc).where(eq(loc.id, b.locationId)).limit(1))[0]?.code ?? "";
    const sku = (await tx.select({ sku: p.sku }).from(p).where(eq(p.id, b.productId)).limit(1))[0]?.sku ?? "";
    const r = await confirmPutaway(tx, auth, ctx, { inventoryId: id, locationCode: target, qty: b.onHand, version: versions.get(id) });
    moved.push({ id, sku, qty: r.totalQty, from, to: r.locationCode });
  });
  return { ...result, moved };
}
