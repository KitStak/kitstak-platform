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
import { countLockFor, countLockMessage } from "@/server/domain/ledger/count-locks";
import { inList } from "./inventory-grid";
import { reasonDirection, type ReasonDirection } from "@/lib/grid-defs/inventory/reason-direction";
import { dbAll, dbGet, mapSeq } from "@/server/db/sql";

export interface ContentLine {
  readonly productId: string;
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
  /** Count plan locking the source location (moves out would fail), with the server's message. */
  readonly countLockPlan: string | null;
  readonly lockMessage: string | null;
  readonly lines: readonly ContentLine[];
}

const MULTI = "Multi";
const DASH = "-";

function single(values: readonly (string | null)[]): string {
  const set = new Set(values.map((v) => v ?? DASH));
  if (set.size === 0) return DASH;
  return set.size === 1 ? [...set][0] : MULTI;
}

async function linesWhere(db: AppDb, auth: AuthContext, where: ReturnType<typeof sql>): Promise<ContentLine[]> {
  const rows = await dbAll<ContentLine & { clientId: string | null }>(db, sql`
    SELECT i.product_id AS "productId", p.sku AS "sku", p.name AS "productName", i.on_hand AS "qty", i.allocated AS "allocated", i.pack_type AS "packType",
      i.status AS "status", i.lot_number AS "lotNumber", i.expiry_date AS "expiryDate", i.production_date AS "productionDate",
      lp.number AS "lpNumber", i.client_id AS "clientId"
    FROM inventory i JOIN products p ON p.id = i.product_id LEFT JOIN license_plates lp ON lp.id = i.lp_id
    WHERE i.on_hand > 0 AND ${where} ORDER BY p.sku`);
  return rows.filter((r) => !r.clientId || hasClient(auth.scope, r.clientId)).map(({ clientId: _c, ...r }) => r);
}

async function lockOf(db: AppDb, location: { id: string; code: string } | null | undefined): Promise<{ countLockPlan: string | null; lockMessage: string | null }> {
  if (!location) return { countLockPlan: null, lockMessage: null };
  const plan = await countLockFor(db, location.id);
  return { countLockPlan: plan, lockMessage: plan ? countLockMessage(location.code, plan) : null };
}

function build(kind: "location" | "lp", id: string, code: string, warehouseId: string, locationCode: string | null, lines: readonly ContentLine[], lock: { countLockPlan: string | null; lockMessage: string | null }): ContentSummary {
  return {
    kind, id, code, warehouseId, locationCode, ...lock,
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

export async function locationSummary(db: AppDb, auth: AuthContext, locationId: string): Promise<ContentSummary> {
  const loc = (await db.select().from(schema.locations).where(eq(schema.locations.id, locationId)).limit(1))[0];
  if (!loc) throw notFoundError("Location");
  assertInScope(auth.scope, loc, "Location");
  return build("location", loc.id, loc.code, loc.warehouseId, loc.code, await linesWhere(db, auth, sql`i.location_id = ${loc.id}`), await lockOf(db, loc));
}

export async function lpSummary(db: AppDb, auth: AuthContext, lpId: string): Promise<ContentSummary> {
  const lp = (await db.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, lpId)).limit(1))[0];
  if (!lp) throw notFoundError("LP");
  assertInScope(auth.scope, { warehouseId: lp.warehouseId }, "LP");
  const loc = lp.locationId ? (await db.select({ id: schema.locations.id, code: schema.locations.code }).from(schema.locations).where(eq(schema.locations.id, lp.locationId)).limit(1))[0] : undefined;
  const children = (await db.select({ id: schema.licensePlates.id }).from(schema.licensePlates).where(eq(schema.licensePlates.parentLpId, lp.id))).map((c) => c.id);
  const ids = [lp.id, ...children];
  return build("lp", lp.id, lp.number, lp.warehouseId, loc?.code ?? null, await linesWhere(db, auth, sql`i.lp_id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`), await lockOf(db, loc));
}

/* ------------------------------------------------------------ placement check */

export interface PlacementCheck {
  readonly kind: "location" | "lp";
  readonly id: string;
  readonly code: string;
  /** Count plan locking the target (or the LP's location). */
  readonly countLockPlan: string | null;
  /** First rule that would make Save fail, in the server's words; null when the move/add is allowed. */
  readonly blocking: string | null;
  /** Non-blocking facts worth showing (e.g. "Only 1 SKU location, empty"). */
  readonly notes: readonly string[];
}

/**
 * Pre-flight for a location / LP picked as a destination (Add Inventory, Transfer Product,
 * Transfer LP / Location): count-plan lock and the "only 1 SKU" rules, checked against the
 * SKUs about to land there. Mirrors the server guards, so the drawer can flag the pick
 * before Submit instead of after a 422.
 */
export async function placementCheck(db: AppDb, auth: AuthContext, input: { kind: "location" | "lp"; id: string; productIds: readonly string[]; excludeInventoryIds?: readonly string[] }): Promise<PlacementCheck> {
  const notes: string[] = [];
  const products = [...new Set(input.productIds)];
  const exclude = input.excludeInventoryIds ?? [];
  const otherSku = async (where: ReturnType<typeof sql>): Promise<string | null> => {
    const notIn = products.length ? sql` AND i.product_id NOT IN (${sql.join(products.map((p) => sql`${p}`), sql`, `)})` : sql``;
    const excl = exclude.length ? sql` AND i.id NOT IN (${sql.join(exclude.map((p) => sql`${p}`), sql`, `)})` : sql``;
    return (await dbGet<{ sku: string }>(db, sql`SELECT p.sku AS "sku" FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.on_hand > 0 AND ${where}${notIn}${excl} ORDER BY p.sku LIMIT 1`))?.sku ?? null;
  };
  const oneSku = async (label: string, where: ReturnType<typeof sql>): Promise<string | null> => {
    const holds = await otherSku(where);
    if (holds) return `${label} allows only 1 SKU (holds ${holds}).`;
    if (products.length > 1) return `${label} allows only 1 SKU; this move has ${products.length} SKUs.`;
    notes.push(`${label} allows only 1 SKU.`);
    return null;
  };

  if (input.kind === "location") {
    const loc = (await db.select().from(schema.locations).where(eq(schema.locations.id, input.id)).limit(1))[0];
    if (!loc) throw notFoundError("Location");
    assertInScope(auth.scope, loc, "Location");
    const { countLockPlan, lockMessage } = await lockOf(db, loc);
    const blocking = lockMessage ?? (loc.onlyOneSku ? await oneSku(`Location ${loc.code}`, sql`i.location_id = ${loc.id}`) : null);
    return { kind: "location", id: loc.id, code: loc.code, countLockPlan, blocking, notes };
  }
  const lp = (await db.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, input.id)).limit(1))[0];
  if (!lp) throw notFoundError("LP");
  assertInScope(auth.scope, { warehouseId: lp.warehouseId }, "LP");
  const loc = lp.locationId ? (await db.select().from(schema.locations).where(eq(schema.locations.id, lp.locationId)).limit(1))[0] : undefined;
  const { countLockPlan, lockMessage } = await lockOf(db, loc);
  const type = (await db.select().from(schema.lpTypes).where(eq(schema.lpTypes.id, lp.lpTypeId)).limit(1))[0];
  let blocking = lockMessage;
  if (!blocking && type?.onlyOneSku) blocking = await oneSku(`LP ${lp.number} (${type.code})`, sql`i.lp_id = ${lp.id}`);
  if (!blocking && loc?.onlyOneSku) blocking = await oneSku(`Location ${loc.code}`, sql`i.location_id = ${loc.id}`);
  if (loc) notes.push(`LP is in ${loc.code}.`);
  return { kind: "lp", id: lp.id, code: lp.number, countLockPlan, blocking, notes };
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

export async function productOptions(db: AppDb, auth: AuthContext, productId: string): Promise<ProductOptions> {
  const p = (await db.select().from(schema.products).where(eq(schema.products.id, productId)).limit(1))[0];
  if (!p || !hasClient(auth.scope, p.clientId)) throw notFoundError("Product");
  const packs = await db.select({ packType: schema.productPackTypes.packType, uomQty: schema.productPackTypes.uomQty })
    .from(schema.productPackTypes).where(eq(schema.productPackTypes.productId, p.id));
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

export async function inventoryReasons(db: AppDb, auth: AuthContext): Promise<InventoryReasons> {
  const lv = schema.lookupValues;
  const list = async (type: "adjustment_reason" | "damage_reason") =>
    (await db.select({ id: lv.id, name: lv.name, meta: lv.meta }).from(lv)
      .where(and(eq(lv.type, type), eq(lv.isActive, true), or(isNull(lv.warehouseId), inList(sql`${lv.warehouseId}`, auth.scope.warehouseIds))))
      .orderBy(lv.sortOrder, lv.name))
      .map((r) => (type === "adjustment_reason" ? { id: r.id, name: r.name, direction: reasonDirection(r.name, r.meta) } : { id: r.id, name: r.name }));
  const whs = (await db.select({ id: schema.warehouses.id, mandatory: schema.warehouses.mandatoryAdjustmentReason }).from(schema.warehouses))
    .filter((w) => auth.scope.warehouseIds.includes(w.id));
  return {
    adjustmentReasons: await list("adjustment_reason"),
    damageReasons: await list("damage_reason"),
    mandatoryReason: Object.fromEntries(whs.map((w) => [w.id, Boolean(w.mandatory)])),
  };
}

/* ------------------------------------------------------------ default reasons (existing tenants) */

/**
 * Reasons every tenant needs so Add / Remove / Adjust always has a one-way choice. Fresh installs
 * get them from the seed; `ensureDefaultInventoryReasons` adds them to databases seeded before
 * they existed. "Found" is the increase-only reason, "Damaged" the decrease-only one.
 */
export const DEFAULT_INVENTORY_REASONS: readonly { readonly type: "adjustment_reason" | "damage_reason"; readonly name: string; readonly direction?: ReasonDirection }[] = [
  { type: "adjustment_reason", name: "Found", direction: "increase" },
  { type: "adjustment_reason", name: "Import", direction: "both" },
  { type: "adjustment_reason", name: "Damaged", direction: "decrease" },
  { type: "damage_reason", name: "Damaged" },
];

/**
 * Idempotent: inserts each default reason that has no global row yet (active or not, so a value
 * an admin deactivated stays deactivated). Returns the names it added.
 */
export async function ensureDefaultInventoryReasons(db: AppDb): Promise<string[]> {
  const lv = schema.lookupValues;
  const added: string[] = [];
  for (const r of DEFAULT_INVENTORY_REASONS) {
    const exists = (await db.select({ id: lv.id }).from(lv)
      .where(and(eq(lv.type, r.type), eq(lv.name, r.name), isNull(lv.clientId), isNull(lv.warehouseId))).limit(1))[0];
    if (exists) continue;
    const max = (await db.select({ n: sql<number>`coalesce(max(${lv.sortOrder}), -1)` }).from(lv).where(eq(lv.type, r.type)).limit(1))[0]?.n ?? -1;
    await db.insert(lv).values({ type: r.type, name: r.name, sortOrder: max + 1, clientId: null, warehouseId: null, meta: r.direction ? { direction: r.direction } : null })
      .onConflictDoNothing();
    added.push(`${r.type}:${r.name}`);
  }
  return added;
}

/* ------------------------------------------------------------ destination options */

export interface DestinationOption {
  readonly id: string;
  readonly label: string;
  /** "Storage · Zone A" plus the restriction, e.g. "Only 1 SKU (holds MLT-WIDGET-01)". */
  readonly description: string;
  /** The rule that would make Save fail for this move (same text as placement-check). */
  readonly blocking: string | null;
  /** Short badge for the option list: "Count CNT0001", "1 SKU · holds X", "1 SKU". */
  readonly badge: string | null;
  readonly countLockPlan: string | null;
  /** The placement check this option was built from (seeds the drawer's pre-flight, no second round-trip). */
  readonly notes: readonly string[];
}

export const DESTINATION_LIMIT = 50;

/**
 * Destination options for Add Inventory / Transfer Product / Transfer LP-Location, with each
 * option's restriction already evaluated (count-plan lock, "only 1 SKU" location / LP type) for
 * the SKUs about to land there. The pickers badge and disable blocked rows up front, so a
 * count-locked or occupied only-1-SKU location never looks selectable (REQ-R2-9b, M06-side).
 */
export async function destinationOptions(
  db: AppDb,
  auth: AuthContext,
  input: { kind: "location" | "lp"; q: string; warehouseId: string | null; productIds: readonly string[]; excludeInventoryIds?: readonly string[]; exact?: boolean; limit?: number },
): Promise<DestinationOption[]> {
  const limit = Math.min(input.limit ?? DESTINATION_LIMIT, DESTINATION_LIMIT);
  const warehouses = input.warehouseId ? auth.scope.warehouseIds.filter((w) => w === input.warehouseId) : auth.scope.warehouseIds;
  const q = input.q.trim();
  const esc = q.replace(/[!%_]/g, (c) => `!${c}`);
  const starts = `${esc}%`;
  const contains = `%${esc}%`;
  const candidates = input.kind === "location"
    ? await dbAll<{ id: string; code: string; areaType: string | null; zone: string | null }>(db, sql`
        SELECT l.id AS "id", l.code AS "code", l.area_type AS "areaType", l.zone AS "zone"
        FROM locations l
        WHERE l.is_active = true AND ${inList(sql`l.warehouse_id`, warehouses)}
          ${q ? (input.exact ? sql`AND (lower(l.code) = lower(${q}) OR lower(l.barcode) = lower(${q}))` : sql`AND (l.code ILIKE ${contains} ESCAPE '!' OR l.barcode ILIKE ${starts} ESCAPE '!')`) : sql``}
        ORDER BY ${q ? sql`CASE WHEN l.code ILIKE ${starts} ESCAPE '!' THEN 0 ELSE 1 END,` : sql``} l.code
        LIMIT ${limit}`)
    : await dbAll<{ id: string; code: string; areaType: string | null; zone: string | null }>(db, sql`
        SELECT lp.id AS "id", lp.number AS "code", lp.status AS "areaType", loc.code AS "zone"
        FROM license_plates lp LEFT JOIN locations loc ON loc.id = lp.location_id
        WHERE ${inList(sql`lp.warehouse_id`, warehouses)}
          ${q ? (input.exact ? sql`AND (lower(lp.number) = lower(${q}) OR lower(lp.alternate_barcode) = lower(${q}))` : sql`AND (lp.number ILIKE ${contains} ESCAPE '!' OR lp.alternate_barcode ILIKE ${starts} ESCAPE '!')`) : sql``}
        ORDER BY ${q ? sql`CASE WHEN lp.number ILIKE ${starts} ESCAPE '!' THEN 0 ELSE 1 END,` : sql``} lp.number
        LIMIT ${limit}`);
  return await mapSeq(candidates, async (c) => {
    const check = await placementCheck(db, auth, { kind: input.kind, id: c.id, productIds: input.productIds, excludeInventoryIds: input.excludeInventoryIds });
    const facts = input.kind === "location" ? [c.areaType, c.zone ? `Zone ${c.zone}` : null] : [c.areaType, c.zone ? `in ${c.zone}` : "Not in a location"];
    const holds = check.blocking ? /holds ([^)]+)\)/.exec(check.blocking)?.[1] ?? null : null;
    const oneSku = check.notes.some((n) => /only 1 SKU/.test(n)) || /only 1 SKU/.test(check.blocking ?? "");
    const badge = check.countLockPlan ? `Count ${check.countLockPlan}` : holds ? `1 SKU · holds ${holds}` : oneSku ? "1 SKU" : null;
    const restriction = check.countLockPlan ? `Locked by count ${check.countLockPlan}` : check.blocking ?? (oneSku ? "Only 1 SKU" : null);
    return {
      id: c.id, label: c.code, blocking: check.blocking, badge, countLockPlan: check.countLockPlan, notes: check.notes,
      description: [...facts.filter(Boolean), restriction].filter(Boolean).join(" · "),
    };
  });
}
