import { and, asc, count, eq, like, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { likePattern, offsetOf, type ListResult } from "./shared";

const { locations, warehouses, inventory } = schema;

export type LocationType = (typeof locations.$inferSelect)["type"];

export const LOCATION_TYPES = [
  "Picking",
  "Reserve",
  "Receiving",
  "Shipping",
  "Returns",
  "Damaged",
] as const;

export interface LocationListParams {
  page: number;
  pageSize: number;
  search?: string;
  zone?: string;
  type?: LocationType;
}

export interface LocationListRow {
  id: string;
  code: string;
  warehouseCode: string;
  zone: string;
  aisle: string;
  bay: string;
  level: string;
  type: LocationType;
  capacityUnits: number;
  isActive: boolean;
  storedUnits: number;
  skuCount: number;
}

export function listLocations(params: LocationListParams): ListResult<LocationListRow> {
  const conds: Array<SQL | undefined> = [];
  if (params.zone) conds.push(eq(locations.zone, params.zone));
  if (params.type) conds.push(eq(locations.type, params.type));
  if (params.search) {
    const p = likePattern(params.search);
    conds.push(or(like(locations.code, p), like(locations.zone, p)));
  }
  const where = and(...conds);

  const invAgg = db
    .select({
      locationId: inventory.locationId,
      storedUnits: sql<number>`coalesce(sum(${inventory.onHand}), 0)`.as("stored_units"),
      skuCount: count().as("sku_count"),
    })
    .from(inventory)
    .groupBy(inventory.locationId)
    .as("loc_inv_agg");

  const rows = db
    .select({
      id: locations.id,
      code: locations.code,
      warehouseCode: warehouses.code,
      zone: locations.zone,
      aisle: locations.aisle,
      bay: locations.bay,
      level: locations.level,
      type: locations.type,
      capacityUnits: locations.capacityUnits,
      isActive: locations.isActive,
      storedUnits: sql<number>`coalesce(${invAgg.storedUnits}, 0)`,
      skuCount: sql<number>`coalesce(${invAgg.skuCount}, 0)`,
    })
    .from(locations)
    .innerJoin(warehouses, eq(locations.warehouseId, warehouses.id))
    .leftJoin(invAgg, eq(invAgg.locationId, locations.id))
    .where(where)
    .orderBy(asc(locations.code))
    .limit(params.pageSize)
    .offset(offsetOf(params.page, params.pageSize))
    .all();
  const total = db.select({ n: count() }).from(locations).where(where).get()?.n ?? 0;
  return { rows, total };
}

/* ============ zone summary ============ */

export interface ZoneSummaryRow {
  zone: string;
  binCount: number;
  capacityUnits: number;
  storedUnits: number;
}

export function getZoneSummary(): ZoneSummaryRow[] {
  const invAgg = db
    .select({
      locationId: inventory.locationId,
      storedUnits: sql<number>`coalesce(sum(${inventory.onHand}), 0)`.as("zs_units"),
    })
    .from(inventory)
    .groupBy(inventory.locationId)
    .as("zs_inv");
  return db
    .select({
      zone: locations.zone,
      binCount: count().as("bin_count"),
      capacityUnits: sql<number>`sum(${locations.capacityUnits})`,
      storedUnits: sql<number>`coalesce(sum(${invAgg.storedUnits}), 0)`,
    })
    .from(locations)
    .leftJoin(invAgg, eq(invAgg.locationId, locations.id))
    .groupBy(locations.zone)
    .orderBy(asc(locations.zone))
    .all();
}
