import { eq, or, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";

/** True when a shipment order exists with this id (UUID) or code (SO010840, any case). */
export function orderExists(key: string): boolean {
  const { shipmentOrders } = schema;
  const row = db
    .select({ id: shipmentOrders.id })
    .from(shipmentOrders)
    .where(or(eq(shipmentOrders.id, key.toLowerCase()), eq(sql`upper(${shipmentOrders.code})`, key.toUpperCase())))
    .get();
  return row !== undefined;
}
