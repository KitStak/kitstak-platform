/**
 * Hospital locations (Logiwa: "Transfer products from this order to a hospital location" — the
 * dedicated place Report Issue / pack-short stock goes). A hospital is an explicitly designated,
 * active, non-virtual location in the warehouse:
 *   - its Location Group is named "Hospital" (configured on the location, Facility › Locations), or
 *   - its code starts with HOSP (naming convention, e.g. HOSP-01).
 * There is deliberately NO fallback to Returns-area or Return Station bins: those are restock
 * targets for customer returns, and mixing pack-short stock into them corrupts both flows.
 * When a warehouse has no hospital, Report Issue says so and links to Locations.
 *
 * This file lists each hospital with the stock in it (and the pack-short order it is held for),
 * and moves free stock back to a storage / picking location (ledger Inventory Movement + change log).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import type { Scope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { changeLog, ledger } from "@/server/domain";
import { DomainError } from "@/server/domain/errors";
import type { DomainCtx } from "@/server/domain/types";
import { validationError } from "@/server/api/errors";
import { idSchema } from "./platform-common";
import { dbAll, dbGet, mapSeq } from "@/server/db/sql";

type Ctx = DomainCtx & { readonly scope: Scope };

/** Location Group name that designates hospital locations (case-insensitive). */
export const HOSPITAL_GROUP_NAME = "Hospital";
/** Code prefix that designates hospital locations (case-insensitive). */
export const HOSPITAL_CODE_PREFIX = "HOSP";

export interface HospitalStockRow {
  readonly inventoryId: string;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly clientName: string | null;
  readonly onHand: number;
  readonly allocated: number;
  readonly free: number;
  readonly lotNumber: string | null;
  readonly status: string;
  readonly damageReason: string | null;
  readonly orders: readonly { readonly id: string; readonly code: string; readonly packShortStatus: string | null }[];
  readonly receivedAt: string;
}

export interface HospitalLocation {
  readonly id: string;
  readonly code: string;
  readonly areaType: string | null;
  readonly locationType: string | null;
  /** How it is designated: by Location Group "Hospital" or by a HOSP* code. */
  readonly designation: "group" | "code";
  readonly isDefault: boolean;
  readonly units: number;
  readonly skus: number;
  readonly heldForOrders: number;
  readonly stock: readonly HospitalStockRow[];
}

export interface HospitalCandidate {
  readonly code: string;
  readonly locationType: string | null;
  readonly groupName?: string | null;
  readonly isActive?: boolean;
}

/** Pure: is this location an explicitly designated hospital? (group "Hospital" or code HOSP*; never virtual / inactive). */
export function isHospitalLocation(l: HospitalCandidate): boolean {
  if (l.isActive === false || l.locationType === "Virtual") return false;
  return hospitalDesignation(l) !== null;
}

/** Pure: how a location is designated a hospital, or null. Location Group wins over the code prefix. */
export function hospitalDesignation(l: HospitalCandidate): "group" | "code" | null {
  if ((l.groupName ?? "").trim().toLowerCase() === HOSPITAL_GROUP_NAME.toLowerCase()) return "group";
  if (l.code.trim().toUpperCase().startsWith(HOSPITAL_CODE_PREFIX)) return "code";
  return null;
}

/** Pure: Damaged stock may not be moved straight into a Picking location (it would be allocatable unreviewed). */
export function moveBackBlockReason(stock: { readonly damageReason: string | null }, target: { readonly areaType: string | null; readonly onlyDamaged?: boolean }): string | null {
  if (!stock.damageReason) return null;
  if (target.areaType === "Picking") return `This stock is marked Damaged (${stock.damageReason}). Move it to a Storage location for review, not a Picking location.`;
  return null;
}

interface HospitalRow { readonly id: string; readonly code: string; readonly areaType: string | null; readonly locationType: string | null; readonly designation: "group" | "code" }

/** Every designated hospital in the warehouse, group-designated first, then by code. */
export async function hospitalLocations(db: AppDb, warehouseId: string): Promise<HospitalRow[]> {
  const rows = await db.select({
    id: schema.locations.id, code: schema.locations.code, areaType: schema.locations.areaType, locationType: schema.locations.locationType,
    isActive: schema.locations.isActive, groupName: schema.lookupValues.name,
  })
    .from(schema.locations)
    .leftJoin(schema.lookupValues, and(eq(schema.lookupValues.id, schema.locations.locationGroupId), eq(schema.lookupValues.isActive, true)))
    .where(and(eq(schema.locations.warehouseId, warehouseId), eq(schema.locations.isActive, true)));
  return rows
    .filter(isHospitalLocation)
    .map((r) => ({ id: r.id, code: r.code, areaType: r.areaType, locationType: r.locationType, designation: hospitalDesignation(r) ?? "code" }))
    .sort((a, b) => (a.designation === b.designation ? 0 : a.designation === "group" ? -1 : 1) || a.code.localeCompare(b.code));
}

/** Is this location id a designated hospital? */
export async function isHospitalLocationId(db: AppDb, locationId: string): Promise<boolean> {
  const r = (await db.select({ code: schema.locations.code, locationType: schema.locations.locationType, isActive: schema.locations.isActive, groupName: schema.lookupValues.name })
    .from(schema.locations)
    .leftJoin(schema.lookupValues, and(eq(schema.lookupValues.id, schema.locations.locationGroupId), eq(schema.lookupValues.isActive, true)))
    .where(eq(schema.locations.id, locationId)).limit(1))[0];
  return r ? isHospitalLocation(r) : false;
}

/** Per in-scope warehouse: how many hospital locations it has and the units in them (warehouse picker default). */
export async function hospitalWarehouses(db: AppDb, scope: Scope): Promise<{ readonly warehouseId: string; readonly hospitals: number; readonly units: number }[]> {
  return await mapSeq(scope.warehouseIds, async (warehouseId) => {
    const locs = await hospitalLocations(db, warehouseId);
    const units = locs.length === 0 ? 0 : (await dbGet<{ n: number }>(db, sql`SELECT COALESCE(SUM(on_hand), 0) AS n FROM inventory WHERE location_id IN (${sql.join(locs.map((l) => sql`${l.id}`), sql`, `)})`))?.n ?? 0;
    return { warehouseId, hospitals: locs.length, units };
  });
}

const inClientScope = (scope: Scope, clientId: string | null): boolean => !clientId || scope.clientIds === "all" || scope.clientIds.includes(clientId);

export async function listHospitals(db: AppDb, scope: Scope, warehouseId: string): Promise<HospitalLocation[]> {
  if (!scope.warehouseIds.includes(warehouseId)) throw new DomainError("NOT_FOUND", "Warehouse not found");
  const locs = await hospitalLocations(db, warehouseId);
  if (locs.length === 0) return [];
  const rows = (await db.select({ inv: schema.inventory, sku: schema.products.sku, name: schema.products.name, clientName: schema.clients.name })
    .from(schema.inventory)
    .innerJoin(schema.products, eq(schema.products.id, schema.inventory.productId))
    .leftJoin(schema.clients, eq(schema.clients.id, schema.inventory.clientId))
    .where(and(inArray(schema.inventory.locationId, locs.map((l) => l.id)), sql`${schema.inventory.onHand} > 0`)))
    .filter((r) => inClientScope(scope, r.inv.clientId));
  const invIds = rows.map((r) => r.inv.id);
  const allocs = invIds.length
    ? await db.select({ inventoryId: schema.inventoryAllocations.inventoryId, orderId: schema.shipmentOrders.id, code: schema.shipmentOrders.code, ps: schema.shipmentOrders.packShortStatus })
      .from(schema.inventoryAllocations)
      .innerJoin(schema.shipmentOrders, eq(schema.shipmentOrders.id, schema.inventoryAllocations.orderId))
      .where(and(inArray(schema.inventoryAllocations.inventoryId, invIds), inArray(schema.inventoryAllocations.status, ["Allocated", "Picked", "Sorted"])))
    : [];
  const byInv = new Map<string, { id: string; code: string; packShortStatus: string | null }[]>();
  for (const a of allocs) {
    const list = byInv.get(a.inventoryId) ?? [];
    if (!list.some((o) => o.id === a.orderId)) list.push({ id: a.orderId, code: a.code, packShortStatus: a.ps ?? null });
    byInv.set(a.inventoryId, list);
  }
  return locs.map((l, i) => {
    const stock = rows.filter((r) => r.inv.locationId === l.id).map((r): HospitalStockRow => ({
      inventoryId: r.inv.id, productId: r.inv.productId, sku: r.sku, productName: r.name, clientName: r.clientName ?? null,
      onHand: r.inv.onHand, allocated: r.inv.allocated, free: Math.max(0, r.inv.onHand - r.inv.allocated),
      lotNumber: r.inv.lotNumber, status: r.inv.status, damageReason: r.inv.damageReason,
      orders: byInv.get(r.inv.id) ?? [], receivedAt: r.inv.receivedAt,
    })).sort((a, b) => a.sku.localeCompare(b.sku));
    return {
      ...l, isDefault: i === 0,
      units: stock.reduce((s, x) => s + x.onHand, 0),
      skus: new Set(stock.map((s) => s.productId)).size,
      heldForOrders: new Set(stock.flatMap((s) => s.orders.map((o) => o.id))).size,
      stock,
    };
  });
}

export const moveBackSchema = z.object({
  inventoryId: z.string({ error: "Choose the hospital stock to move" }).trim().min(1, "Choose the hospital stock to move").max(64),
  qty: z.number({ error: "Enter a quantity" }).int("Enter a whole number").min(1, "Move at least 1 unit"),
  toLocationId: z.string({ error: "Choose a location" }).trim().min(1, "Choose a location").max(64),
  note: z.string().trim().max(500).optional(),
});

/**
 * Move back: free (unallocated) hospital stock to a non-hospital Storage / Picking location in the
 * same warehouse. Ledger Inventory Movement, plus change-log rows on both locations. Damaged stock
 * cannot go to a Picking location.
 */
export async function moveBackFromHospital(tx: AppDb, ctx: Ctx, input: z.output<typeof moveBackSchema>): Promise<{ readonly moved: number; readonly toCode: string }> {
  const inv = (await tx.select().from(schema.inventory).where(eq(schema.inventory.id, input.inventoryId)).limit(1))[0];
  if (!inv || !ctx.scope.warehouseIds.includes(inv.warehouseId) || !inClientScope(ctx.scope, inv.clientId)) throw new DomainError("NOT_FOUND", "Stock not found");
  const from = (await tx.select().from(schema.locations).where(eq(schema.locations.id, inv.locationId)).limit(1))[0];
  if (!from || !(await isHospitalLocationId(tx, from.id))) throw new DomainError("INVALID_STATE", "This stock is not in a hospital location.");
  const to = (await tx.select().from(schema.locations).where(eq(schema.locations.id, input.toLocationId)).limit(1))[0];
  if (!to || to.warehouseId !== inv.warehouseId || !to.isActive) throw validationError("Choose an active location in the same warehouse", { toLocationId: ["Location is not in this warehouse"] });
  if (await isHospitalLocationId(tx, to.id)) throw validationError("Choose a storage or picking location, not another hospital", { toLocationId: ["That is a hospital location"] });
  if (to.areaType !== "Storage" && to.areaType !== "Picking") throw validationError("Choose a Storage or Picking location", { toLocationId: [`${to.code} is a ${to.areaType ?? "non-storage"} location`] });
  const blocked = moveBackBlockReason(inv, to);
  if (blocked) throw validationError(blocked, { toLocationId: ["Damaged stock cannot go to a Picking location"] });
  const free = inv.onHand - inv.allocated;
  if (free <= 0) throw new DomainError("INVALID_STATE", "All of this stock is held for a pack-short order. Resolve the pack short in Orders first.");
  if (input.qty > free) throw validationError(`Max ${free} free unit${free === 1 ? "" : "s"}`, { qty: [`Max ${free}`] });
  const product = (await tx.select({ sku: schema.products.sku }).from(schema.products).where(eq(schema.products.id, inv.productId)).limit(1))[0];
  const sku = product?.sku ?? "Product";
  const onHandAt = async (locationId: string): Promise<number> => (await dbGet<{ n: number }>(tx, sql`SELECT coalesce(sum(on_hand), 0) AS n FROM inventory WHERE location_id = ${locationId} AND product_id = ${inv.productId}`))?.n ?? 0;
  const toBefore = await onHandAt(to.id);
  const fromBefore = await onHandAt(from.id);
  await ledger.move(tx, ctx, {
    inventoryId: inv.id, qty: input.qty, toLocationId: to.id, toLpId: null, type: "Inventory Movement",
    refs: { note: `Hospital move back from ${from.code} to ${to.code}${input.note ? `: ${input.note}` : ""}` },
  });
  const line = { lineEntityType: "inventory", lineLabel: sku, field: "onHand" } as const;
  await changeLog.recordLine(tx, ctx, { entityType: "location", entityId: from.id, entityCode: from.code, lineEntityId: inv.id, ...line, from: fromBefore, to: fromBefore - input.qty });
  await changeLog.recordLine(tx, ctx, { entityType: "location", entityId: to.id, entityCode: to.code, lineEntityId: inv.id, ...line, from: toBefore, to: toBefore + input.qty });
  return { moved: input.qty, toCode: to.code };
}

export interface MoveBackTarget { readonly id: string; readonly code: string; readonly detail: string; readonly areaType: string }

/** Targets for Move back: active, non-hospital Storage / Picking locations. */
export async function moveBackTargets(db: AppDb, scope: Scope, warehouseId: string, q: string): Promise<MoveBackTarget[]> {
  if (!scope.warehouseIds.includes(warehouseId)) throw new DomainError("NOT_FOUND", "Warehouse not found");
  const like = `%${q.trim()}%`;
  const hosp = new Set((await hospitalLocations(db, warehouseId)).map((h) => h.id));
  return (await dbAll<MoveBackTarget>(db, sql`SELECT id, code, area_type AS "areaType", coalesce(area_type, '') || ' · ' || coalesce(location_type, '') AS detail FROM locations
    WHERE warehouse_id = ${warehouseId} AND is_active = true AND area_type IN ('Storage', 'Picking') AND code ILIKE ${like} ESCAPE ''
    ORDER BY CASE area_type WHEN 'Picking' THEN 0 ELSE 1 END, code LIMIT 80`)).filter((t) => !hosp.has(t.id)).slice(0, 50);
}
