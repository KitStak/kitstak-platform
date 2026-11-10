/**
 * Putaway (BUILD_PLAN F5 `putaway.ts`).
 *
 * `suggestLocations` walks the active putaway algorithm's rule chain (If / If-else): the
 * first rule whose conditions match and whose actions leave at least one location wins;
 * its order-by ranks the result. The trace explains every rule tried (beyond Logiwa's
 * Test Algorithm). Suggestions also pass the ledger's hard placement rules.
 *
 * `dynamicReplenishmentTargets`: To Replenish = Max + Open Order Qty − Target Available − Open Replenish Task Qty.
 */
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { OrderByClause, RuleCondition } from "@/lib/domain-types";
import { zoneGroupIds } from "@/lib/grid-defs/admin/lookups";
import { CUSTOM_FIELD_SLOTS } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import type { AlgorithmAction } from "@/server/db/schema";
import { OPEN_SO_STATUSES } from "./atp";
import { evaluateConditions, type Facts } from "./conditions";
import { DomainError } from "./errors";
import { sortByClauses } from "./facts";
import { assertLocationAccepts, type LocationRow } from "./ledger/rules";
import { findPutawayAction, zoneSpreadAllows, type LocationStats, type PutawayItem } from "./putaway-actions";
import type { Tx } from "./types";

export interface SuggestInput {
  readonly warehouseId: string;
  readonly productId: string;
  readonly qty: number;
  /** Part of `qty` already allocated to orders (Allocated Transfer Quantity condition). */
  readonly allocatedQty?: number;
  readonly packType?: string;
  readonly lpId?: string | null;
  readonly lot?: string | null;
  readonly expiry?: string | null;
  readonly productionDate?: string | null;
  readonly damageReason?: string | null;
  readonly isReceiving: boolean;
  readonly fromLocationId?: string | null;
  readonly receivedAt?: string;
  readonly algorithmId?: string | null;
  readonly limit?: number;
}

export interface Suggestion {
  readonly locationId: string;
  readonly code: string;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface TraceEntry {
  readonly rule: string;
  readonly matched: boolean;
  readonly message: string;
  readonly candidates: number;
}

export interface SuggestResult {
  readonly algorithm: string;
  readonly rule: string | null;
  readonly suggestions: readonly Suggestion[];
  readonly trace: readonly TraceEntry[];
}

interface PutawayRule {
  readonly name: string;
  readonly conditions: readonly RuleCondition[];
  readonly actions: readonly AlgorithmAction[];
  readonly orderBy: readonly OrderByClause[];
}

const WALK: OrderByClause[] = [{ field: "walkingPathPriority", dir: "asc" }];
export const DEFAULT_PUTAWAY_RULES: readonly PutawayRule[] = [
  { name: "Default Same SKU", conditions: [], actions: [{ action: "checkSameClient" }, { action: "checkDamagedLocations" }, { action: "checkLocationCapacity" }, { action: "suggestSameSku" }], orderBy: WALK },
  { name: "Default Empty Location", conditions: [], actions: [{ action: "checkDamagedLocations" }, { action: "suggestEmptyLocation" }], orderBy: WALK },
];

function loadRules(tx: Tx, warehouseId: string, algorithmId?: string | null): { name: string; rules: readonly PutawayRule[] } {
  const a = schema.algorithms;
  const algo = algorithmId
    ? tx.select().from(a).where(eq(a.id, algorithmId)).get()
    : tx.select().from(a).where(and(eq(a.warehouseId, warehouseId), eq(a.kind, "Putaway"), eq(a.status, "Active"), eq(a.isDynamicReplenishment, false))).orderBy(asc(a.createdAt)).get();
  if (algorithmId && (!algo || algo.kind !== "Putaway")) throw new DomainError("NOT_FOUND", "Putaway algorithm not found");
  if (!algo) return { name: "Default", rules: DEFAULT_PUTAWAY_RULES };
  const rules = tx.select().from(schema.algorithmRules).where(and(eq(schema.algorithmRules.algorithmId, algo.id), eq(schema.algorithmRules.isActive, true)))
    .orderBy(asc(schema.algorithmRules.sequence)).all()
    .map((r) => ({ name: r.name, conditions: r.conditions, actions: r.actions ?? [], orderBy: r.orderBy.length > 0 ? r.orderBy : WALK }));
  return { name: algo.name, rules };
}

const lookupName = (tx: Tx, id: string | null): string | null =>
  id ? tx.select({ name: schema.lookupValues.name }).from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get()?.name ?? null : null;

function locationStats(tx: Tx, warehouseId: string, productId: string): Map<string, LocationStats> {
  const locs = tx.select().from(schema.locations).where(and(eq(schema.locations.warehouseId, warehouseId), eq(schema.locations.isActive, true))).all();
  const stock = tx.select({ inv: schema.inventory, groupId: schema.products.productGroupId, typeId: schema.products.productTypeId, l: schema.products.lengthIn, w: schema.products.widthIn, h: schema.products.heightIn })
    .from(schema.inventory).innerJoin(schema.products, eq(schema.products.id, schema.inventory.productId))
    .where(and(eq(schema.inventory.warehouseId, warehouseId), gt(schema.inventory.onHand, 0))).all();
  const caps = tx.select().from(schema.locationProductCapacity).all();
  const zones = tx.select({ id: schema.lookupValues.id, name: schema.lookupValues.name, meta: schema.lookupValues.meta }).from(schema.lookupValues).where(eq(schema.lookupValues.type, "location_zone")).all();
  const zoneNames = new Map(zones.map((z) => [z.id, z.name]));
  const zoneGroups = new Map(zones.map((z) => [z.id, new Set(zoneGroupIds(z.meta))]));
  const zoneNum = (meta: unknown, key: string): number | null => {
    const v = (meta as Record<string, unknown> | null)?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const zonePriority = new Map(zones.map((z) => [z.id, zoneNum(z.meta, "priority")]));
  const zoneMax = new Map(zones.map((z) => [z.id, zoneNum(z.meta, "maxLocationsPerSku")]));
  const out = new Map<string, LocationStats>();
  for (const location of locs) {
    const rows = stock.filter((s) => s.inv.locationId === location.id);
    const set = (f: (r: (typeof rows)[number]) => string | null) => new Set(rows.map((r) => f(r) ?? ""));
    const locCaps = caps.filter((c) => c.locationId === location.id);
    const own = locCaps.find((c) => c.productId === productId);
    out.set(location.id, {
      location, zoneName: (location.locationZoneId ? zoneNames.get(location.locationZoneId) : null) ?? location.zone ?? null,
      zoneProductGroupIds: (location.locationZoneId ? zoneGroups.get(location.locationZoneId) : undefined) ?? new Set<string>(),
      zonePriority: location.locationZoneId ? zonePriority.get(location.locationZoneId) ?? null : null,
      zoneMaxLocationsPerSku: location.locationZoneId ? zoneMax.get(location.locationZoneId) ?? null : null,
      totalQty: rows.reduce((s, r) => s + r.inv.onHand, 0), allocatedQty: rows.reduce((s, r) => s + r.inv.allocated, 0),
      usedVolume: rows.reduce((s, r) => s + r.inv.onHand * r.l * r.w * r.h, 0), lpCount: new Set(rows.flatMap((r) => (r.inv.lpId ? [r.inv.lpId] : []))).size,
      skus: new Set(rows.map((r) => r.inv.productId)), skuPackTypes: new Set(rows.map((r) => `${r.inv.productId}|${r.inv.packType}`)),
      packTypes: set((r) => r.inv.packType), clients: set((r) => r.inv.clientId), lots: set((r) => r.inv.lotNumber), expiries: set((r) => r.inv.expiryDate),
      productionDates: set((r) => r.inv.productionDate), receivedDays: set((r) => r.inv.receivedAt.slice(0, 10)), damageReasons: set((r) => r.inv.damageReason),
      productGroups: set((r) => r.groupId), productTypes: set((r) => r.typeId), assignedProducts: new Set(locCaps.map((c) => c.productId)),
      productCapacityMax: own ? own.maxQty : null, productQty: rows.filter((r) => r.inv.productId === productId).reduce((s, r) => s + r.inv.onHand, 0),
    });
  }
  return out;
}

/** Custom-field slots as prefixed facts: `productCustomField.toggle1` etc. Every slot is present (null when unset). */
function prefixedCustomFields(prefix: string, values: Readonly<Record<string, string | boolean | null | undefined>> | null | undefined): Facts {
  return Object.fromEntries(CUSTOM_FIELD_SLOTS.map((slot) => [`${prefix}.${slot}`, values?.[slot] ?? null]));
}

function ruleFacts(tx: Tx, input: SuggestInput, product: typeof schema.products.$inferSelect, source: LocationRow | null): Facts {
  const lp = input.lpId ? tx.select({ typeId: schema.licensePlates.lpTypeId, parentLpId: schema.licensePlates.parentLpId }).from(schema.licensePlates).where(eq(schema.licensePlates.id, input.lpId)).get() : undefined;
  const lpTypeRow = lp ? tx.select({ code: schema.lpTypes.code, customFields: schema.lpTypes.customFields }).from(schema.lpTypes).where(eq(schema.lpTypes.id, lp.typeId)).get() : undefined;
  const lpType = lpTypeRow?.code ?? null;
  // A parent LP (it holds child LPs) or an LP nested in a parent is a parent-LP-based transfer.
  const hasChildren = input.lpId ? Boolean(tx.select({ id: schema.licensePlates.id }).from(schema.licensePlates).where(eq(schema.licensePlates.parentLpId, input.lpId)).limit(1).get()) : false;
  // LP Carrier: carrier of the open shipment order whose line is pinned to this LP.
  const lpCarrier = input.lpId
    ? tx.select({ carrier: schema.shipmentOrders.carrier }).from(schema.orderLines).innerJoin(schema.shipmentOrders, eq(schema.shipmentOrders.id, schema.orderLines.orderId))
      .where(and(eq(schema.orderLines.pinnedLpId, input.lpId), inArray(schema.shipmentOrders.status, [...OPEN_SO_STATUSES]))).limit(1).get()?.carrier ?? null
    : null;
  const sourceCustom = source ? tx.select({ cf: schema.locations.customFields, preventAllocation: schema.locations.preventAllocation }).from(schema.locations).where(eq(schema.locations.id, source.id)).get() : undefined;
  return {
    allocatedTransferQuantity: input.allocatedQty ?? 0,
    isPreventAllocation: sourceCustom ? sourceCustom.preventAllocation : null,
    lpCarrier,
    isParentLpTransfer: lp ? Boolean(lp.parentLpId) || hasChildren : false,
    ...prefixedCustomFields("locationCustomField", sourceCustom?.cf),
    ...prefixedCustomFields("lpTypeCustomField", lpTypeRow?.customFields),
    ...prefixedCustomFields("productCustomField", product.customFields),
    client: product.clientId, sku: product.sku, productGroup: product.productGroupId, productType: product.productTypeId,
    productPackType: input.packType ?? product.uom, damageReason: input.damageReason ?? null, expiryDate: input.expiry ?? null,
    lotBatchNumber: input.lot ?? null, productionDate: input.productionDate ?? null, receivingDate: input.receivedAt ?? null,
    isReceivingProcess: input.isReceiving, transferQuantity: input.qty, weight: product.weightOz * input.qty,
    volume: product.lengthIn * product.widthIn * product.heightIn * input.qty, width: product.widthIn, height: product.heightIn,
    length: product.lengthIn, purchasePrice: product.purchasePrice, lpType,
    location: source?.code ?? null, areaType: source?.areaType ?? null, abcCode: source?.abcCode ?? null, replenishmentType: source?.replenishmentType ?? null,
    locationZone: source?.locationZoneId ?? null, locationGroup: source?.locationGroupId ?? null, locationType: source?.locationType ?? null,
    aisle: source?.aisle ?? null, level: source?.level ?? null, column: source?.column ?? null,
  };
}

function orderFactsOf(s: LocationStats): Facts {
  return {
    aisle: s.location.aisle, allocatedQuantity: s.allocatedQty, column: s.location.column, level: s.location.level,
    locationEmptyVolume: Math.max(0, s.location.volume - s.usedVolume), lpCountInLocation: s.lpCount, skuCountInLocation: s.skus.size,
    totalInventoryQuantity: s.totalQty, walkingPathPriority: s.location.walkingPathPriority, // Data Setup zone priority when set (lower first); zones without one fall back to their name.
    zonePriority: s.zonePriority ?? s.zoneName ?? s.location.zone,
  };
}

export function suggestLocations(tx: Tx, input: SuggestInput): SuggestResult {
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new DomainError("VALIDATION", "Quantity must be a positive whole number");
  const product = tx.select().from(schema.products).where(eq(schema.products.id, input.productId)).get();
  if (!product) throw new DomainError("NOT_FOUND", "Product not found");
  const source = input.fromLocationId ? tx.select().from(schema.locations).where(eq(schema.locations.id, input.fromLocationId)).get() ?? null : null;
  const { name, rules } = loadRules(tx, input.warehouseId, input.algorithmId);
  const item: PutawayItem = {
    productId: product.id, clientId: product.clientId, packType: input.packType ?? product.uom, qty: input.qty, lotNumber: input.lot ?? null,
    expiryDate: input.expiry ?? null, productionDate: input.productionDate ?? null, damageReason: input.damageReason ?? null,
    receivedAt: input.receivedAt ?? new Date().toISOString(), productGroupId: product.productGroupId, productTypeId: product.productTypeId,
    unitVolume: product.lengthIn * product.widthIn * product.heightIn,
  };
  const stats = locationStats(tx, input.warehouseId, product.id);
  const productLocationIds = new Set([...stats.values()].filter((s) => s.skus.has(product.id)).map((s) => s.location.id));
  const productGroupName = lookupName(tx, product.productGroupId);
  const facts = ruleFacts(tx, input, product, source);
  // Zone "Max locations per SKU": count the zones' locations already holding the product.
  const productLocationsByZone = new Map<string, number>();
  for (const s of stats.values()) {
    const zoneId = s.location.locationZoneId;
    if (zoneId && productLocationIds.has(s.location.id)) productLocationsByZone.set(zoneId, (productLocationsByZone.get(zoneId) ?? 0) + 1);
  }
  const base = [...stats.values()].filter((s) => s.location.id !== input.fromLocationId && !s.location.isLocked && zoneSpreadAllows(s, productLocationIds, productLocationsByZone));
  const trace: TraceEntry[] = [];
  for (const rule of rules) {
    if (!evaluateConditions(rule.conditions, facts)) {
      trace.push({ rule: rule.name, matched: false, message: "Conditions did not match", candidates: 0 });
      continue;
    }
    const reasons = new Map<string, string[]>();
    let cands = base;
    for (const a of rule.actions) {
      const def = findPutawayAction(a.action);
      if (!def) { trace.push({ rule: rule.name, matched: true, message: `Unknown action "${a.action}" ignored`, candidates: cands.length }); continue; }
      cands = cands.filter((s) => def.fn({ item, stats: s, value: a.value, productGroupName, productLocationIds }) === null);
      for (const s of cands) reasons.set(s.location.id, [...(reasons.get(s.location.id) ?? []), def.label]);
    }
    cands = cands.filter((s) => {
      try {
        assertLocationAccepts(tx, { warehouseId: input.warehouseId, clientId: product.clientId, productId: product.id, locationId: s.location.id, lpId: null,
          lotNumber: item.lotNumber, expiryDate: item.expiryDate, productionDate: item.productionDate, damageReason: item.damageReason, packType: item.packType, status: "Stock" }, input.qty);
        return true;
      } catch {
        return false;
      }
    });
    if (cands.length === 0) {
      trace.push({ rule: rule.name, matched: true, message: "No location satisfied the rule's actions", candidates: 0 });
      continue;
    }
    const ranked = sortByClauses(cands, rule.orderBy, orderFactsOf).slice(0, input.limit ?? 10);
    trace.push({ rule: rule.name, matched: true, message: `${cands.length} location(s) matched`, candidates: cands.length });
    return {
      algorithm: name, rule: rule.name, trace,
      suggestions: ranked.map((s, i) => ({ locationId: s.location.id, code: s.location.code, score: Math.max(1, 100 - i), reasons: reasons.get(s.location.id) ?? ["Applied to all"] })),
    };
  }
  return { algorithm: name, rule: null, suggestions: [], trace };
}

export interface ReplenishmentTarget {
  readonly productId: string;
  readonly sku: string;
  readonly min: number;
  readonly max: number;
  readonly openOrderQty: number;
  readonly targetAvailable: number;
  readonly openTaskQty: number;
  readonly toReplenish: number;
}

export function dynamicReplenishmentTargets(tx: Tx, warehouseId: string, opts: { onlyNeeded?: boolean } = {}): ReplenishmentTarget[] {
  const levels = tx.select().from(schema.productReplenishmentLevels).where(eq(schema.productReplenishmentLevels.warehouseId, warehouseId)).all();
  const perWh = new Map(levels.map((l) => [l.productId, l]));
  const globals = tx.select().from(schema.products).where(and(eq(schema.products.replenishmentStrategy, "Global"), gt(schema.products.replenishmentMax, 0))).all();
  const ids = [...new Set([...perWh.keys(), ...globals.map((p) => p.id)])];
  if (ids.length === 0) return [];
  const products = new Map(tx.select().from(schema.products).where(inArray(schema.products.id, ids)).all().map((p) => [p.id, p]));
  const statusList = sql.raw(OPEN_SO_STATUSES.map((s) => `'${s}'`).join(","));
  const out: ReplenishmentTarget[] = [];
  for (const id of ids) {
    const product = products.get(id);
    if (!product) continue;
    const lvl = perWh.get(id);
    const min = lvl?.minLevel ?? product.replenishmentMin;
    const max = lvl?.maxLevel ?? product.replenishmentMax;
    const open = tx.get<{ q: number }>(sql`SELECT COALESCE(SUM(l.quantity - l.cancelled_quantity - l.picked_quantity), 0) AS q
      FROM order_lines l JOIN shipment_orders o ON o.id = l.order_id
      WHERE l.product_id = ${id} AND o.warehouse_id = ${warehouseId} AND o.deleted_at IS NULL AND o.status IN (${statusList})`)?.q ?? 0;
    const avail = tx.get<{ q: number }>(sql`SELECT COALESCE(SUM(i.on_hand - i.allocated), 0) AS q FROM inventory i JOIN locations loc ON loc.id = i.location_id
      WHERE i.product_id = ${id} AND i.warehouse_id = ${warehouseId} AND i.status = 'Stock' AND i.damage_reason IS NULL
        AND (loc.replenishment_type = 'Target' OR loc.area_type = 'Picking')`)?.q ?? 0;
    const tasks = tx.get<{ q: number }>(sql`SELECT COALESCE(SUM(planned_qty - actual_qty), 0) AS q FROM tasks
      WHERE product_id = ${id} AND warehouse_id = ${warehouseId} AND task_type = 'Replenishment' AND status IN ('Pending','Started')`)?.q ?? 0;
    const toReplenish = Math.max(0, max + Number(open) - Number(avail) - Number(tasks));
    const row = { productId: id, sku: product.sku, min, max, openOrderQty: Number(open), targetAvailable: Number(avail), openTaskQty: Number(tasks), toReplenish };
    if (!opts.onlyNeeded || toReplenish > 0) out.push(row);
  }
  return out.sort((a, b) => b.toReplenish - a.toReplenish || a.sku.localeCompare(b.sku));
}
