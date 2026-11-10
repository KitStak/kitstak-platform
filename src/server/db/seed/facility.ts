/**
 * Facility: locations for both warehouses (area/location type, walking path, zone/group,
 * barcode), default receive/ship/return locations, pick faces with product capacity and
 * replenishment levels, LP types, license plates, mobile carts and shipment packages.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { nextLpNumber } from "@/server/domain/sequences";
import type { Tx } from "@/server/domain/types";
import type { CatalogRefs, ProductRef } from "./catalog";
import {
  DEFAULT_LOCATIONS, KS2_CLIENTS, KS2_PACKAGES, LOCKED_LOCATION, PACK_STATIONS, PACKAGES, locationsFor, type LocationDef, type WarehouseCode,
} from "./facility-data";
import { lookupId, lookupKey, type LookupRefs } from "./lookups";
import type { OrgRefs } from "./org";
import type { Id, IdMap } from "./types";
import { round2 } from "./types";

export interface LpRef {
  readonly id: Id;
  readonly number: string;
}

export interface WarehouseFacility {
  readonly code: WarehouseCode;
  readonly id: Id;
  readonly locations: IdMap;
  readonly recv: Id;
  readonly ship: Id;
  readonly rtn: Id;
  readonly packStations: readonly Id[];
  readonly load: readonly Id[];
  readonly kit: Id | null;
  readonly damaged: Id | null;
  /** Reserve (Storage) rack + bulk location ids in walking order (locked excluded). */
  readonly reserve: readonly Id[];
  /** Home pick face per product id. */
  readonly pickFaces: ReadonlyMap<Id, Id>;
  /** Products stocked in this warehouse. */
  readonly products: readonly ProductRef[];
  readonly lpTypes: Readonly<Record<"PT" | "PC" | "PLT", Id>>;
  readonly pallets: readonly LpRef[];
  readonly totes: readonly LpRef[];
  readonly packages: IdMap;
}

export interface FacilityRefs {
  readonly MLT1: WarehouseFacility;
  readonly KS2: WarehouseFacility;
}

const CAPACITY_PICK_FACES = 40;

function insertLocations(tx: Tx, warehouseId: Id, defs: readonly LocationDef[], lookups: LookupRefs): Map<string, Id> {
  const ids = new Map<string, Id>();
  defs.forEach((l, i) => {
    const volume = round2(l.dims[0] * l.dims[1] * l.dims[2]);
    const id = tx.insert(schema.locations).values({
      warehouseId, code: l.code, zone: l.zone, aisle: l.aisle, bay: l.bay, level: l.level, type: l.legacyType, capacityUnits: l.capacityUnits,
      barcode: l.code, displayMember: l.code, areaType: l.areaType, locationType: l.locationType, replenishmentType: l.replenishmentType,
      walkingPathPriority: (i + 1) * 10, abcCode: l.abc, column: Number(l.bay) || 0, rack: l.zone === "Dock" ? null : `${l.zone}${l.aisle}`,
      length: l.dims[0], width: l.dims[1], height: l.dims[2], volume, onlyDamaged: l.onlyDamaged ?? false, isLocked: l.isLocked ?? false,
      locationZoneId: lookups.byWarehouse.get(lookupKey(warehouseId, "location_zone", l.zone)) ?? null,
      locationGroupId: lookups.byWarehouse.get(lookupKey(warehouseId, "location_group", l.group)) ?? null,
    }).returning({ id: schema.locations.id }).get().id;
    ids.set(l.code, id);
  });
  return ids;
}

function insertLpTypes(tx: Tx, warehouseId: Id): Record<"PT" | "PC" | "PLT", Id> {
  const ins = (row: Omit<typeof schema.lpTypes.$inferInsert, "warehouseId">): Id =>
    tx.insert(schema.lpTypes).values({ warehouseId, ...row }).returning({ id: schema.lpTypes.id }).get().id;
  return {
    PT: ins({ code: "PT", description: "Picking Tote", numberPrefix: "PT-", numberLength: 6, length: 24, width: 16, height: 12, emptyWeight: 38, maxWeight: 800, maxVolume: 4608, onlyOneOrder: true }),
    PC: ins({ code: "PC", description: "Picking Cart", numberPrefix: "PC-", numberLength: 5, length: 48, width: 24, height: 60, emptyWeight: 520, maxWeight: 4800, maxVolume: 69120, onlyOneJob: true }),
    PLT: ins({ code: "PLT", description: "Pallet", numberPrefix: "PLT", numberLength: 7, length: 48, width: 40, height: 60, emptyWeight: 640, maxWeight: 32000, maxVolume: 115200, suitableForParentLp: true, onlyOneClient: true }),
  };
}

function createLps(tx: Tx, warehouseId: Id, lpTypeId: Id, count: number): LpRef[] {
  return Array.from({ length: count }, () => {
    const number = nextLpNumber(tx, lpTypeId);
    const id = tx.insert(schema.licensePlates).values({ number, warehouseId, lpTypeId, status: "Empty" }).returning({ id: schema.licensePlates.id }).get().id;
    return { id, number };
  });
}

function insertPackages(tx: Tx, warehouseId: Id, codes: readonly string[], catalog: CatalogRefs): Map<string, Id> {
  const ids = new Map<string, Id>();
  for (const p of PACKAGES.filter((x) => codes.includes(x.code))) {
    const tracked = p.trackedSku ? catalog.bySku.get(p.trackedSku) : undefined;
    const id = tx.insert(schema.shipmentPackages).values({
      warehouseId, code: p.code, description: p.description, emptyWeight: p.emptyWeightLb, maxWeight: p.maxWeightLb,
      length: p.dims[0], width: p.dims[1], height: p.dims[2], maxVolume: round2(p.dims[0] * p.dims[1] * p.dims[2]), purchasePrice: p.price,
      trackInventory: Boolean(tracked), inventoryClientId: tracked?.clientId ?? null, inventoryProductId: tracked?.id ?? null,
      reductionRule: tracked ? "Packing Station" : null,
    }).returning({ id: schema.shipmentPackages.id }).get().id;
    ids.set(p.code, id);
  }
  return ids;
}

function stockedProducts(code: WarehouseCode, catalog: CatalogRefs): ProductRef[] {
  const base = catalog.products.filter((p) => p.kitType !== "Kit to Order");
  if (code === "MLT1") return base;
  return base.filter((p) => KS2_CLIENTS.includes(p.clientCode) && !p.isPackaging && !p.kitType).slice(0, 28);
}

function assignPickFaces(products: readonly ProductRef[], defs: readonly LocationDef[], ids: IdMap): Map<Id, Id> {
  const faces = defs.filter((l) => l.areaType === "Picking" && l.level !== "3").map((l) => ids.get(l.code) as Id);
  const out = new Map<Id, Id>();
  products.filter((p) => !p.isPackaging).forEach((p, i) => {
    if (i < faces.length) out.set(p.id, faces[i]);
  });
  return out;
}

function seedPickFaceRules(tx: Tx, warehouseId: Id, faces: ReadonlyMap<Id, Id>, products: readonly ProductRef[], withCapacity: number): void {
  const list = products.filter((p) => faces.has(p.id));
  list.forEach((p, i) => {
    const max = p.category === "Coffee" ? 72 : p.caseQty ? p.caseQty * 3 : 48;
    const min = Math.max(6, Math.round(max / 4));
    if (i < withCapacity) {
      tx.insert(schema.locationProductCapacity).values({ locationId: faces.get(p.id) as Id, clientId: p.clientId, productId: p.id, packType: p.uom, minQty: min, maxQty: max }).run();
    }
    tx.insert(schema.productReplenishmentLevels).values({ productId: p.id, warehouseId, minLevel: min, maxLevel: max }).run();
  });
}

function seedMobileCarts(tx: Tx, warehouseId: Id, lookups: LookupRefs): void {
  const cartTypeId = lookupId(lookups, "mobile_cart_type", "24-bin 4×6");
  for (let c = 1; c <= 4; c += 1) {
    const code = `MC-${String(c).padStart(2, "0")}`;
    const cartId = tx.insert(schema.mobileCarts).values({ code, warehouseId, description: `24-bin pick cart ${c}`, cartTypeId, levels: 4, columns: 6, allowMultipleJob: c === 4 })
      .returning({ id: schema.mobileCarts.id }).get().id;
    const cells = [];
    for (let level = 1; level <= 4; level += 1) for (let column = 1; column <= 6; column += 1) cells.push({ cartId, level, column, barcode: `${code}-${level}-${column}` });
    tx.insert(schema.mobileCartCells).values(cells).run();
  }
}

function seedWarehouse(tx: Tx, code: WarehouseCode, warehouseId: Id, catalog: CatalogRefs, lookups: LookupRefs): WarehouseFacility {
  const defs = locationsFor(code);
  const locations = insertLocations(tx, warehouseId, defs, lookups);
  const loc = (c: string): Id => locations.get(c) as Id;
  const d = DEFAULT_LOCATIONS[code];
  tx.update(schema.warehouses).set({ defaultReceivingLocationId: loc(d.recv), defaultShipLocationId: loc(d.ship), defaultReturnLocationId: loc(d.rtn) })
    .where(eq(schema.warehouses.id, warehouseId)).run();
  const products = stockedProducts(code, catalog);
  const pickFaces = assignPickFaces(products, defs, locations);
  seedPickFaceRules(tx, warehouseId, pickFaces, products, code === "MLT1" ? CAPACITY_PICK_FACES : 0);
  const lpTypes = insertLpTypes(tx, warehouseId);
  const pallets = createLps(tx, warehouseId, lpTypes.PLT, code === "MLT1" ? 50 : 12);
  const totes = createLps(tx, warehouseId, lpTypes.PT, code === "MLT1" ? 36 : 12);
  createLps(tx, warehouseId, lpTypes.PC, code === "MLT1" ? 8 : 2);
  if (code === "MLT1") seedMobileCarts(tx, warehouseId, lookups);
  const reserve = defs.filter((l) => l.areaType === "Storage" && !l.onlyDamaged && l.code !== LOCKED_LOCATION).map((l) => loc(l.code));
  return {
    code, id: warehouseId, locations, recv: loc(d.recv), ship: loc(d.ship), rtn: loc(d.rtn), packStations: PACK_STATIONS[code].map(loc),
    load: defs.filter((l) => l.areaType === "Loading").map((l) => loc(l.code)), kit: locations.get("KIT-01") ?? null,
    damaged: locations.get("DMG-01") ?? null, reserve, pickFaces, products, lpTypes, pallets, totes,
    packages: insertPackages(tx, warehouseId, code === "MLT1" ? PACKAGES.map((p) => p.code) : KS2_PACKAGES, catalog),
  };
}

export function seedFacility(tx: Tx, org: OrgRefs, catalog: CatalogRefs, lookups: LookupRefs): FacilityRefs {
  return {
    MLT1: seedWarehouse(tx, "MLT1", org.mlt1, catalog, lookups),
    KS2: seedWarehouse(tx, "KS2", org.ks2, catalog, lookups),
  };
}
