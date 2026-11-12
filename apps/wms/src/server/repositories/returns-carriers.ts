/**
 * Carrier → service options for a warehouse (and client access), used by Create RMA
 * (return label) and the Packing Station (Carrier* / Shipping Service* cascade). Only
 * connections whose carrier adapter is installed are offered, so every option can
 * actually buy a label.
 */
import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import * as schema from "@/server/db/schema";
import { getCarrierAdapter } from "@/server/domain/carriers";

export interface CarrierServiceOption {
  readonly id: string;
  readonly name: string;
  readonly serviceCode: string;
  readonly transitDays: number | null;
}

export interface CarrierOption {
  /** `<connectionId>|<carrierCode>` — stable select value. */
  readonly key: string;
  readonly connectionId: string;
  readonly connectionName: string;
  readonly carrierCode: string;
  readonly services: readonly CarrierServiceOption[];
}

export async function carrierOptions(db: AppDb, warehouseId: string, clientId?: string | null): Promise<CarrierOption[]> {
  const conns = (await db.select().from(schema.carrierConnections)
    .where(and(eq(schema.carrierConnections.warehouseId, warehouseId), eq(schema.carrierConnections.isActive, true))))
    .filter((c) => getCarrierAdapter(c.provider) !== undefined);
  const out: CarrierOption[] = [];
  for (const conn of conns) {
    if (clientId) {
      const access = (await db.select().from(schema.carrierConnectionClients)
        .where(and(eq(schema.carrierConnectionClients.connectionId, conn.id), eq(schema.carrierConnectionClients.clientId, clientId))).limit(1))[0];
      if (access && !access.hasAccess) continue;
    }
    const services = await db.select().from(schema.carrierServices)
      .where(and(eq(schema.carrierServices.connectionId, conn.id), eq(schema.carrierServices.isActive, true)));
    const byCarrier = new Map<string, CarrierServiceOption[]>();
    for (const s of services) {
      const list = byCarrier.get(s.carrierCode) ?? [];
      byCarrier.set(s.carrierCode, [...list, { id: s.id, name: s.name, serviceCode: s.serviceCode, transitDays: s.transitDays ?? null }]);
    }
    for (const [carrierCode, list] of byCarrier) {
      out.push({ key: `${conn.id}|${carrierCode}`, connectionId: conn.id, connectionName: conn.setupName, carrierCode, services: [...list].sort((a, b) => a.name.localeCompare(b.name)) });
    }
  }
  return out.sort((a, b) => a.carrierCode.localeCompare(b.carrierCode) || a.connectionName.localeCompare(b.connectionName));
}
