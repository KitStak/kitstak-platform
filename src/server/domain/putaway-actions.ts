/**
 * The 38 putaway rule actions (spec 06 §3 "Add Action"). "Check …" actions reject
 * locations that break a constraint; "Suggest …" actions keep only locations with a
 * property. Each returns `null` (keep) or a rejection reason.
 */
import type { LocationRow } from "./ledger/rules";

/**
 * REQ-J1-1: a zone matches a product group when the zone lists that group in Data Setup.
 * Zones with no matched groups keep the legacy rule (zone name equals group name). PURE.
 */
export function zoneMatchesProductGroup(
  stats: { readonly zoneName: string | null; readonly zoneProductGroupIds?: ReadonlySet<string> },
  productGroupId: string | null,
  productGroupName: string | null,
): boolean {
  const ids = stats.zoneProductGroupIds;
  if (ids && ids.size > 0) return productGroupId !== null && ids.has(productGroupId);
  return productGroupName !== null && stats.zoneName !== null && productGroupName.toLowerCase() === stats.zoneName.toLowerCase();
}

/**
 * Zone "Max locations per SKU" (Data Setup): a location that doesn't hold the product yet is
 * refused once the product already sits in that many locations of the same zone. Locations that
 * already hold it stay eligible (topping up never spreads the SKU). PURE.
 */
export function zoneSpreadAllows(
  stats: { readonly location: { readonly id: string; readonly locationZoneId: string | null }; readonly zoneMaxLocationsPerSku?: number | null },
  productLocationIds: ReadonlySet<string>,
  productLocationsByZone: ReadonlyMap<string, number>,
): boolean {
  const max = stats.zoneMaxLocationsPerSku;
  const zoneId = stats.location.locationZoneId;
  if (!max || !zoneId || productLocationIds.has(stats.location.id)) return true;
  return (productLocationsByZone.get(zoneId) ?? 0) < max;
}

export interface PutawayItem {
  readonly productId: string;
  readonly clientId: string;
  readonly packType: string;
  readonly qty: number;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly damageReason: string | null;
  readonly receivedAt: string;
  readonly productGroupId: string | null;
  readonly productTypeId: string | null;
  readonly unitVolume: number;
}

export interface LocationStats {
  readonly location: LocationRow;
  readonly zoneName: string | null;
  /** Product groups matched to the location's zone in Data Setup (meta.productGroupIds). */
  readonly zoneProductGroupIds?: ReadonlySet<string>;
  /** Data Setup zone priority (lower is visited first); null when the zone has none. */
  readonly zonePriority?: number | null;
  /** Data Setup "Max locations per SKU" for the location's zone; null = no limit. */
  readonly zoneMaxLocationsPerSku?: number | null;
  readonly totalQty: number;
  readonly allocatedQty: number;
  readonly usedVolume: number;
  readonly lpCount: number;
  readonly skus: ReadonlySet<string>;
  readonly skuPackTypes: ReadonlySet<string>; // `${productId}|${packType}`
  readonly packTypes: ReadonlySet<string>;
  readonly clients: ReadonlySet<string>;
  readonly lots: ReadonlySet<string>;
  readonly expiries: ReadonlySet<string>;
  readonly productionDates: ReadonlySet<string>;
  readonly receivedDays: ReadonlySet<string>;
  readonly damageReasons: ReadonlySet<string>;
  readonly productGroups: ReadonlySet<string>;
  readonly productTypes: ReadonlySet<string>;
  readonly assignedProducts: ReadonlySet<string>;
  readonly productCapacityMax: number | null;
  readonly productQty: number;
}

export interface ActionContext {
  readonly item: PutawayItem;
  readonly stats: LocationStats;
  readonly value: unknown;
  readonly productGroupName: string | null;
  /** Distinct locations holding the product in the warehouse. */
  readonly productLocationIds: ReadonlySet<string>;
}

type ActionFn = (c: ActionContext) => string | null;

const key = (v: string | null): string => v ?? "";
const valueList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined || v === null ? [] : [String(v)]);
const sameAs = (set: ReadonlySet<string>, value: string | null, what: string): string | null =>
  set.size === 0 || (set.size === 1 && set.has(key(value))) ? null : `holds a different ${what}`;
const has = (cond: boolean, reason: string): string | null => (cond ? null : reason);

function capacity(c: ActionContext): string | null {
  const loc = c.stats.location;
  if (loc.capacityType === "Maximum Unit Quantity" && loc.maxCapacityQty > 0 && c.stats.totalQty + c.item.qty > loc.maxCapacityQty) {
    return `capacity ${loc.maxCapacityQty} units would be exceeded`;
  }
  if (c.stats.productCapacityMax !== null && c.stats.productCapacityMax > 0 && c.stats.productQty + c.item.qty > c.stats.productCapacityMax) {
    return `SKU capacity ${c.stats.productCapacityMax} would be exceeded`;
  }
  return null;
}

const SUGGEST_FIELD: Readonly<Record<string, (l: LocationRow) => string | number | null>> = {
  suggestAisle: (l) => l.aisle, suggestColumn: (l) => l.column, suggestHeight: (l) => l.height, suggestLength: (l) => l.length,
  suggestLevel: (l) => l.level, suggestVolume: (l) => l.volume, suggestWidth: (l) => l.width,
  suggestAbcCode: (l) => l.abcCode, suggestAreaType: (l) => l.areaType, suggestLocationGroup: (l) => l.locationGroupId,
  suggestLocationType: (l) => l.locationType, suggestLocationZone: (l) => l.locationZoneId, suggestReplenishmentType: (l) => l.replenishmentType,
};

const fieldAction = (name: string): ActionFn => (c) => {
  const actual = SUGGEST_FIELD[name](c.stats.location);
  const wanted = valueList(c.value).map((v) => v.toLowerCase());
  return has(wanted.length > 0 && actual !== null && wanted.includes(String(actual).toLowerCase()), `does not match ${name.replace("suggest", "")}`);
};

export const PUTAWAY_ACTIONS: readonly { readonly key: string; readonly label: string; readonly fn: ActionFn }[] = [
  { key: "checkAssignedSkus", label: "Check Assigned SKUs", fn: (c) => has(c.stats.assignedProducts.size === 0 || c.stats.assignedProducts.has(c.item.productId), "is assigned to other SKUs") },
  { key: "checkDamagedLocations", label: "Check Damaged Locations", fn: (c) => has(c.stats.location.onlyDamaged === (c.item.damageReason !== null), c.item.damageReason ? "is not a damaged-stock location" : "only accepts damaged stock") },
  { key: "checkLocationCapacity", label: "Check Location Capacity", fn: capacity },
  { key: "checkLocationCapacityType", label: "Check Location Capacity Type", fn: (c) => has(c.stats.location.capacityType !== "None", "has no capacity type") },
  { key: "checkMaxLocationsPerSku", label: "Check Max Locations per SKU", fn: (c) => {
    const max = Number(c.value ?? 0);
    return has(!(max > 0) || c.productLocationIds.size < max || c.productLocationIds.has(c.stats.location.id), `SKU already uses ${c.productLocationIds.size} locations`);
  } },
  { key: "checkMaxSkuCount", label: "Check Max Sku Count", fn: (c) => {
    const max = c.stats.location.maxSkuQty ?? 0;
    const after = new Set([...c.stats.skus, c.item.productId]).size;
    return has(max <= 0 || after <= max, `allows at most ${max} SKUs`);
  } },
  { key: "checkProductGroupLocationZoneMatch", label: "Check Product Group&Location Zone Match", fn: (c) =>
    has(zoneMatchesProductGroup(c.stats, c.item.productGroupId, c.productGroupName), "zone does not match the product group") },
  { key: "checkSameClient", label: "Check Same Client", fn: (c) => has((c.stats.clients.size === 0 || (c.stats.clients.size === 1 && c.stats.clients.has(c.item.clientId)))
    && (!c.stats.location.dedicatedClientId || c.stats.location.dedicatedClientId === c.item.clientId), "holds another client's stock") },
  { key: "checkSameDamagedReason", label: "Check Same Damaged Reason", fn: (c) => sameAs(c.stats.damageReasons, c.item.damageReason, "damage reason") },
  { key: "checkSameExpiryDate", label: "Check Same Expiry Date", fn: (c) => sameAs(c.stats.expiries, c.item.expiryDate, "expiry date") },
  { key: "checkSameLotBatchNumber", label: "Check Same Lot Batch Number", fn: (c) => sameAs(c.stats.lots, c.item.lotNumber, "lot/batch number") },
  { key: "checkSameProductGroup", label: "Check Same Product Group", fn: (c) => sameAs(c.stats.productGroups, c.item.productGroupId, "product group") },
  { key: "checkSameProductType", label: "Check Same Product Type", fn: (c) => sameAs(c.stats.productTypes, c.item.productTypeId, "product type") },
  { key: "checkSameProductionDate", label: "Check the same Production Date", fn: (c) => sameAs(c.stats.productionDates, c.item.productionDate, "production date") },
  { key: "checkSameReceivingDate", label: "Check the same Receiving Date", fn: (c) => sameAs(c.stats.receivedDays, c.item.receivedAt.slice(0, 10), "receiving date") },
  { key: "configureVolumetricPutaway", label: "Configure Volumetric Putaway", fn: (c) => {
    const vol = c.stats.location.volume;
    return has(vol <= 0 || c.stats.usedVolume + c.item.unitVolume * c.item.qty <= vol, "does not have enough free volume");
  } },
  { key: "suggestSameSkuSamePackType", label: "Suggest a location that has inventory of the same SKU & same pack type", fn: (c) => has(c.stats.skuPackTypes.has(`${c.item.productId}|${c.item.packType}`), "has no stock of this SKU and pack type") },
  { key: "suggestSelectedProductGroup", label: "Suggest a location that has inventory of the selected product group", fn: (c) => has(valueList(c.value).some((v) => c.stats.productGroups.has(v)), "has no stock of the selected product group") },
  { key: "suggestSelectedProductType", label: "Suggest a location that has inventory of the selected product type", fn: (c) => has(valueList(c.value).some((v) => c.stats.productTypes.has(v)), "has no stock of the selected product type") },
  { key: "suggestSelectedPackType", label: "Suggest a location that has inventory of this selected pack type", fn: (c) => has((valueList(c.value).length > 0 ? valueList(c.value) : [c.item.packType]).some((v) => c.stats.packTypes.has(v)), "has no stock of the selected pack type") },
  { key: "suggestSameSku", label: "Suggest a location that has the same SKU", fn: (c) => has(c.stats.skus.has(c.item.productId) || c.stats.assignedProducts.has(c.item.productId), "has no stock of this SKU") },
  { key: "suggestAllocationPrevented", label: "Suggest a location where the allocation is prevented", fn: (c) => has(c.stats.location.preventAllocation, "allows allocation") },
  { key: "suggestInventorySyncPrevented", label: "Suggest a location where the inventory sync to stores is prevented", fn: (c) => has(c.stats.location.preventInventorySync, "allows inventory sync") },
  ...["Aisle", "Column", "Height", "Length", "Level", "Volume", "Width"].map((f) => ({ key: `suggest${f}`, label: `Suggest a location with the entered ${f.toLowerCase()}`, fn: fieldAction(`suggest${f}`) })),
  ...[["AbcCode", "ABC Code"], ["AreaType", "area type"], ["LocationGroup", "location group"], ["LocationType", "location type"], ["LocationZone", "location zone"], ["ReplenishmentType", "replenishment type"]]
    .map(([k, l]) => ({ key: `suggest${k}`, label: `Suggest a location with the selected ${l}`, fn: fieldAction(`suggest${k}`) })),
  { key: "suggestEmptyLocation", label: "Suggest an empty location", fn: (c) => has(c.stats.totalQty === 0, "is not empty") },
  { key: "suggestExactLocation", label: "Suggest exactly the selected location", fn: (c) => has(valueList(c.value).some((v) => v === c.stats.location.id || v === c.stats.location.code), "is not the selected location") },
];

const BY_KEY = new Map(PUTAWAY_ACTIONS.flatMap((a) => [[a.key, a], [a.label.toLowerCase(), a]] as const));

export function findPutawayAction(name: string): (typeof PUTAWAY_ACTIONS)[number] | undefined {
  return BY_KEY.get(name) ?? BY_KEY.get(name.toLowerCase());
}
