import type { Metadata } from "next";
import { Suspense } from "react";
import { asc, count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { SettingsPage } from "@/components/settings/settings-page";
import type { SettingsCounts, WarehouseCard } from "@/components/settings/types";

export const metadata: Metadata = { title: "Settings" };

/** Static carrier integrations rendered by the Carriers tab. */
const CARRIER_COUNT = 4;

function loadWarehouses(): WarehouseCard[] {
  const { warehouses, locations } = schema;
  const locAgg = db
    .select({
      warehouseId: locations.warehouseId,
      binCount: count().as("bin_count"),
      zoneCount: sql<number>`count(distinct ${locations.zone})`.as("zone_count"),
      capacityUnits: sql<number>`coalesce(sum(${locations.capacityUnits}), 0)`.as(
        "capacity_units"
      ),
    })
    .from(locations)
    .groupBy(locations.warehouseId)
    .as("wh_loc_agg");

  return db
    .select({
      id: warehouses.id,
      code: warehouses.code,
      name: warehouses.name,
      addressLine: warehouses.addressLine,
      city: warehouses.city,
      state: warehouses.state,
      isDefault: warehouses.isDefault,
      binCount: sql<number>`coalesce(${locAgg.binCount}, 0)`,
      zoneCount: sql<number>`coalesce(${locAgg.zoneCount}, 0)`,
      capacityUnits: sql<number>`coalesce(${locAgg.capacityUnits}, 0)`,
    })
    .from(warehouses)
    .leftJoin(locAgg, eq(locAgg.warehouseId, warehouses.id))
    .orderBy(asc(warehouses.code))
    .all();
}

function loadCounts(warehouseCount: number): SettingsCounts {
  const users = db.select({ n: count() }).from(schema.users).get()?.n ?? 0;
  const audit = db.select({ n: count() }).from(schema.auditLog).get()?.n ?? 0;
  return { users, warehouses: warehouseCount, carriers: CARRIER_COUNT, audit };
}

export default function Page() {
  const warehouses = loadWarehouses();
  const counts = loadCounts(warehouses.length);
  return (
    <Suspense>
      <SettingsPage warehouses={warehouses} counts={counts} />
    </Suspense>
  );
}
