/**
 * Read models for the inventory drawers: Transfer LP / Transfer Location "Find" summary
 * cards (spec 04 §2.5–2.6), product options for Add Inventory (pack types, tracked
 * attributes), and the reason lists with the warehouse "mandatory reason" flag.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { AppDb } from "@/server/api/db";
import { notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { assertInScope, hasClient } from "@/server/auth/scope";
import { inList } from "./inventory-grid";

export interface ContentLine {
  readonly sku: string;
  readonly productName: string;
  readonly qty: number;
  readonly allocated: number;
  readonly packType: string;
  readonly status: string;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly lpNumber: string | null;
}

export interface ContentSummary {
  readonly kind: "location" | "lp";
  readonly id: string;
  readonly code: string;
  readonly warehouseId: string;
  readonly locationCode: string | null;
  readonly lpLabel: string;
  readonly lotLabel: string;
  readonly packTypeLabel: string;
  readonly packQty: number;
  readonly skuLabel: string;
  readonly skuCount: number;
  readonly expiryLabel: string;
  readonly productionLabel: string;
  readonly allocatedQty: number;
  readonly lines: readonly ContentLine[];
}

const MULTI = "Multi";
const DASH = "-";

function single(values: readonly (string | null)[]): string {
  const set = new Set(values.map((v) => v ?? DASH));
  if (set.size === 0) return DASH;
  return set.size === 1 ? [...set][0] : MULTI;
}

function linesWhere(db: AppDb, auth: AuthContext, where: ReturnType<typeof sql>): ContentLine[] {
  const rows = db.all<ContentLine & { clientId: string | null }>(sql`
    SELECT p.sku AS "sku", p.name AS "productName", i.on_hand AS "qty", i.allocated AS "allocated", i.pack_type AS "packType",
      i.status AS "status", i.lot_number AS "lotNumber", i.expiry_date AS "expiryDate", i.production_date AS "productionDate",
      lp.number AS "lpNumber", i.client_id AS "clientId"
    FROM inventory i JOIN products p ON p.id = i.product_id LEFT JOIN license_plates lp ON lp.id = i.lp_id
    WHERE i.on_hand > 0 AND ${where} ORDER BY p.sku`);
  return rows.filter((r) => !r.clientId || hasClient(auth.scope, r.clientId)).map(({ clientId: _c, ...r }) => r);
}

function build(kind: "location" | "lp", id: string, code: string, warehouseId: string, locationCode: string | null, lines: readonly ContentLine[]): ContentSummary {
  return {
    kind, id, code, warehouseId, locationCode,
    lpLabel: kind === "lp" ? code : single(lines.map((l) => l.lpNumber)),
    lotLabel: single(lines.map((l) => l.lotNumber)),
    packTypeLabel: single(lines.map((l) => l.packType)),
    packQty: lines.reduce((s, l) => s + l.qty, 0),
    skuLabel: single(lines.map((l) => l.sku)),
    skuCount: new Set(lines.map((l) => l.sku)).size,
    expiryLabel: single(lines.map((l) => l.expiryDate)),
    productionLabel: single(lines.map((l) => l.productionDate)),
    allocatedQty: lines.reduce((s, l) => s + l.allocated, 0),
    lines,
  };
}

export function locationSummary(db: AppDb, auth: AuthContext, locationId: string): ContentSummary {
  const loc = db.select().from(schema.locations).where(eq(schema.locations.id, locationId)).get();
  if (!loc) throw notFoundError("Location");
  assertInScope(auth.scope, loc, "Location");
  return build("location", loc.id, loc.code, loc.warehouseId, loc.code, linesWhere(db, auth, sql`i.location_id = ${loc.id}`));
}

export function lpSummary(db: AppDb, auth: AuthContext, lpId: string): ContentSummary {
  const lp = db.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, lpId)).get();
  if (!lp) throw notFoundError("LP");
  assertInScope(auth.scope, { warehouseId: lp.warehouseId }, "LP");
  const loc = lp.locationId ? db.select({ code: schema.locations.code }).from(schema.locations).where(eq(schema.locations.id, lp.locationId)).get() : undefined;
  const children = db.select({ id: schema.licensePlates.id }).from(schema.licensePlates).where(eq(schema.licensePlates.parentLpId, lp.id)).all().map((c) => c.id);
  const ids = [lp.id, ...children];
  return build("lp", lp.id, lp.number, lp.warehouseId, loc?.code ?? null, linesWhere(db, auth, sql`i.lp_id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`));
}

export interface ProductOptions {
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly uom: string;
  readonly packTypes: readonly { readonly packType: string; readonly uomQty: number }[];
  readonly trackLot: boolean;
  readonly trackExpiry: boolean;
  readonly trackProductionDate: boolean;
  readonly trackSerial: boolean;
}

export function productOptions(db: AppDb, auth: AuthContext, productId: string): ProductOptions {
  const p = db.select().from(schema.products).where(eq(schema.products.id, productId)).get();
  if (!p || !hasClient(auth.scope, p.clientId)) throw notFoundError("Product");
  const packs = db.select({ packType: schema.productPackTypes.packType, uomQty: schema.productPackTypes.uomQty })
    .from(schema.productPackTypes).where(eq(schema.productPackTypes.productId, p.id)).all();
  const packTypes = packs.some((x) => x.packType === p.uom) ? packs : [{ packType: p.uom, uomQty: 1 }, ...packs];
  return {
    productId: p.id, sku: p.sku, name: p.name, uom: p.uom,
    packTypes: [...packTypes].sort((a, b) => a.uomQty - b.uomQty),
    trackLot: p.trackLot, trackExpiry: p.trackExpiry, trackProductionDate: p.trackProductionDate, trackSerial: p.trackSerial,
  };
}

export interface ReasonOption {
  readonly id: string;
  readonly name: string;
}

export interface InventoryReasons {
  readonly adjustmentReasons: readonly ReasonOption[];
  readonly damageReasons: readonly ReasonOption[];
  /** warehouseId → reason required for add/adjust/remove. */
  readonly mandatoryReason: Readonly<Record<string, boolean>>;
}

export function inventoryReasons(db: AppDb, auth: AuthContext): InventoryReasons {
  const lv = schema.lookupValues;
  const list = (type: "adjustment_reason" | "damage_reason") =>
    db.select({ id: lv.id, name: lv.name }).from(lv)
      .where(and(eq(lv.type, type), eq(lv.isActive, true), or(isNull(lv.warehouseId), inList(sql`${lv.warehouseId}`, auth.scope.warehouseIds))))
      .orderBy(lv.sortOrder, lv.name).all();
  const whs = db.select({ id: schema.warehouses.id, mandatory: schema.warehouses.mandatoryAdjustmentReason }).from(schema.warehouses).all()
    .filter((w) => auth.scope.warehouseIds.includes(w.id));
  return {
    adjustmentReasons: list("adjustment_reason"),
    damageReasons: list("damage_reason"),
    mandatoryReason: Object.fromEntries(whs.map((w) => [w.id, Boolean(w.mandatory)])),
  };
}
