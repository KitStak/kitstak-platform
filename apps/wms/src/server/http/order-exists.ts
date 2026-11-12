import { eq, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db";

/** True when a shipment order exists with this id (UUID) or code (SO010840, any case). */
export async function orderExists(key: string): Promise<boolean> {
  const { shipmentOrders } = schema;
  const db = await getDb();
  const [row] = await db
    .select({ id: shipmentOrders.id })
    .from(shipmentOrders)
    .where(or(eq(shipmentOrders.id, key.toLowerCase()), eq(sql`upper(${shipmentOrders.code})`, key.toUpperCase())))
    .limit(1);
  return row !== undefined;
}
