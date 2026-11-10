/**
 * Uniqueness pre-checks for the M10 wizards (`GET /api/<entity>/availability`): lets step 1
 * flag a taken code / prefix inline on blur or Next, before the final Save. The write paths
 * keep their own authoritative checks (`assertCodeFree` / `assertPrefixFree`); this only reads.
 * Messages match the server's duplicate errors word for word.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import * as s from "@/server/db/schema";
import { assertWarehouseInScope } from "./locations-shared";

export const availabilityQuerySchema = z.object({
  warehouseId: z.string().trim().max(64).optional(),
  code: z.string().trim().max(120).optional(),
  prefix: z.string().trim().max(20).optional(),
  excludeId: z.string().trim().max(64).optional(),
  /** LP numbers only: the custom number's optional second scan code. */
  alternateBarcode: z.string().trim().max(60).optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/** Field path → message for every value that is already taken; empty when all are free. */
export type AvailabilityResult = { readonly taken: Readonly<Record<string, string>> };

export type AvailabilityEntity = "location" | "warehouse" | "lp_type" | "lp_number" | "mobile_cart" | "shipment_package";

function firstOther(db: AppDb, table: typeof s.locations | typeof s.lpTypes | typeof s.mobileCarts | typeof s.shipmentPackages | typeof s.warehouses, where: SQL | undefined, excludeId?: string): { id: string; code: string } | undefined {
  const rows = db.select({ id: table.id, code: table.code }).from(table).where(where).limit(2).all();
  return rows.find((r) => r.id !== excludeId);
}

export function checkAvailability(db: AppDb, auth: AuthContext, entity: AvailabilityEntity, q: AvailabilityQuery): AvailabilityResult {
  const taken: Record<string, string> = {};
  const code = q.code?.trim();
  if (entity === "warehouse") {
    if (code && firstOther(db, s.warehouses, sql`lower(${s.warehouses.code}) = lower(${code})`, q.excludeId)) taken.code = `Warehouse ${code} already exists`;
    return { taken };
  }
  if (!q.warehouseId) return { taken };
  assertWarehouseInScope(auth, q.warehouseId);
  switch (entity) {
    case "location": {
      const t = s.locations;
      if (code && firstOther(db, t, and(eq(t.warehouseId, q.warehouseId), sql`lower(${t.code}) = lower(${code})`), q.excludeId)) taken["info.code"] = `Location ${code} already exists in this warehouse`;
      break;
    }
    case "lp_type": {
      const t = s.lpTypes;
      if (code && firstOther(db, t, and(eq(t.warehouseId, q.warehouseId), sql`lower(${t.code}) = lower(${code})`), q.excludeId)) taken.code = `LP type ${code} already exists in this warehouse`;
      const prefix = q.prefix?.trim();
      if (prefix) {
        const clash = db.select({ id: t.id, code: t.code }).from(t).where(and(eq(t.warehouseId, q.warehouseId), sql`upper(${t.numberPrefix}) = upper(${prefix})`)).limit(2).all().find((r) => r.id !== q.excludeId);
        if (clash) taken.numberPrefix = `Prefix ${prefix.toUpperCase()} is already used by LP type ${clash.code}`;
      }
      break;
    }
    case "lp_number": {
      // Same rule as the create path's assertNumberFree: unique per warehouse across every LP type.
      const t = s.licensePlates;
      if (code && db.select({ id: t.id }).from(t).where(and(eq(t.warehouseId, q.warehouseId), sql`upper(${t.number}) = upper(${code})`)).limit(2).all().some((r) => r.id !== q.excludeId)) taken.number = `LP number ${code.toUpperCase()} already exists in this warehouse`;
      const alt = q.alternateBarcode?.trim();
      if (alt && db.select({ id: t.id }).from(t).where(and(eq(t.warehouseId, q.warehouseId), eq(t.alternateBarcode, alt))).limit(2).all().some((r) => r.id !== q.excludeId)) taken.alternateBarcode = `Alternate barcode ${alt} is already used`;
      break;
    }
    case "mobile_cart": {
      const t = s.mobileCarts;
      if (code && firstOther(db, t, and(eq(t.warehouseId, q.warehouseId), sql`lower(${t.code}) = lower(${code})`), q.excludeId)) taken.code = `Mobile cart ${code} already exists in this warehouse`;
      break;
    }
    case "shipment_package": {
      const t = s.shipmentPackages;
      if (code && firstOther(db, t, and(eq(t.warehouseId, q.warehouseId), sql`lower(${t.code}) = lower(${code})`), q.excludeId)) taken.code = `Shipment package ${code} already exists in this warehouse`;
      break;
    }
  }
  return { taken };
}
