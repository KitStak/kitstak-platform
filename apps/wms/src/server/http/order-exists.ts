import { eq, or, sql } from 'drizzle-orm';
import { schema } from '@/server/db';
import { getAppDb, getPlatformDb, getTenantDbFor, type AppDb } from '@/server/api/db';

/**
 * The warehouse handle for a proxy-time check: the session org's warehouse when request
 * headers are given (one separate warehouse per organization), else the request's.
 * Null when the session does not resolve (the page itself decides what to show).
 */
async function warehouseDb(headers?: Headers): Promise<AppDb | null> {
  if (!headers) return await getAppDb();
  const platform = await getPlatformDb();
  const { resolveSession } = await import('@/server/auth/session-store');
  const session = await resolveSession(platform, headers);
  if (!session.ok) return null;
  return session.user.tenantSchema === 'wms' ? platform : await getTenantDbFor(session.user.tenantSchema);
}

/**
 * True when a shipment order exists with this id (UUID) or code (SO010840, any case) in
 * the session org's warehouse. Also true when the session does not resolve: never 404 a
 * page the gate cannot judge.
 */
export async function orderExists(key: string, headers?: Headers): Promise<boolean> {
  const { shipmentOrders } = schema;
  const db = await warehouseDb(headers);
  if (!db) return true;
  const [row] = await db
    .select({ id: shipmentOrders.id })
    .from(shipmentOrders)
    .where(
      or(eq(shipmentOrders.id, key.toLowerCase()), eq(sql`upper(${shipmentOrders.code})`, key.toUpperCase())),
    )
    .limit(1);
  return row !== undefined;
}
