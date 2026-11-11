/**
 * Import handler "inventory" (owner M06, spec 04 §2.9).
 *
 * Each row adds stock through `ledger.add` as an `Inventory Adjustment` with the
 * adjustment reason "Import" (looked up by name; when the lookup is missing the note
 * still reads "Import"). Location / LP mixing rules apply exactly as in the UI, so a
 * row that breaks a rule fails alone with the rule message.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { ledger } from "@/server/domain/ledger";
import { packRatio } from "@/server/domain/ledger/bucket";
import { hasClient, hasWarehouse } from "@/server/auth/scope";
import { explainSkuRule, isValidIsoDate } from "@/server/repositories/inventory-commands";
import { LOT_MESSAGE, isValidLot } from "@/lib/grid-defs/inventory/lot-rules";
import type { ImportHandler, ImportRowValues } from "../types";

export const IMPORT_REASON_NAME = "Import";

const str = (v: ImportRowValues[string]): string | null => (v === null || v === undefined || v === "" ? null : String(v).trim());

/**
 * Calendar date cell → "YYYY-MM-DD" (validate.ts already parsed it; this is the second line of
 * defence). Impossible dates such as "2026-02-31" or "2026-13-45" fail the row.
 */
export function importDate(v: ImportRowValues[string], label: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(String(v).trim());
  const iso = m ? `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}` : String(v).trim();
  if (!isValidIsoDate(iso)) fail(`${label} "${String(v)}" is not a real date (use YYYY-MM-DD)`);
  return iso;
}

function fail(message: string): never {
  throw new DomainError("VALIDATION", message);
}

export const handler: ImportHandler = {
  configured: true,
  owner: "M06",
  async apply(ctx, row) {
    const { db, auth } = ctx;
    const whCode = str(row.warehouseCode) ?? fail("Warehouse Code is required");
    const wh = (await db.select().from(schema.warehouses).where(eq(schema.warehouses.code, whCode)).limit(1))[0];
    if (!wh || !hasWarehouse(auth.scope, wh.id)) fail(`Warehouse "${whCode}" was not found`);

    const clientCode = str(row.clientCode) ?? fail("Client Code is required");
    const client = (await db.select().from(schema.clients).where(eq(schema.clients.code, clientCode)).limit(1))[0];
    if (!client || !hasClient(auth.scope, client.id)) fail(`Client "${clientCode}" was not found`);

    const sku = str(row.sku) ?? fail("SKU is required");
    const product = (await db.select().from(schema.products).where(and(eq(schema.products.clientId, client.id), eq(schema.products.sku, sku))).limit(1))[0];
    if (!product) fail(`SKU "${sku}" was not found for client ${clientCode}`);

    const locCode = str(row.locationCode) ?? fail("Location Code is required");
    const location = (await db.select().from(schema.locations).where(and(eq(schema.locations.warehouseId, wh.id), eq(schema.locations.code, locCode))).limit(1))[0];
    if (!location) fail(`Location "${locCode}" was not found in ${whCode}`);

    const lpNumber = str(row.lpNumber);
    let lpId: string | null = null;
    if (lpNumber) {
      const lp = (await db.select().from(schema.licensePlates).where(and(eq(schema.licensePlates.warehouseId, wh.id), eq(schema.licensePlates.number, lpNumber))).limit(1))[0];
      if (!lp) fail(`LP "${lpNumber}" was not found in ${whCode}`);
      lpId = lp.id;
    }

    const packType = str(row.packType) ?? product.uom;
    if (packType !== product.uom) {
      const pack = (await db.select().from(schema.productPackTypes).where(and(eq(schema.productPackTypes.productId, product.id), eq(schema.productPackTypes.packType, packType))).limit(1))[0];
      if (!pack) fail(`Pack type "${packType}" is not set up for ${sku}`);
    }
    const qty = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
    if (!Number.isInteger(qty) || qty <= 0) fail("Quantity must be a positive whole number");

    const status = str(row.status) ?? "Stock";
    let damageReason = str(row.damageReason);
    if (status !== "Stock" && !damageReason) fail(`Damage Reason is required when Status is ${status}`);
    if (damageReason) {
      const reason = (await db.select().from(schema.lookupValues)
        .where(and(eq(schema.lookupValues.type, "damage_reason"), eq(schema.lookupValues.name, damageReason))).limit(1))[0];
      if (!reason) fail(`Damage Reason "${damageReason}" is not set up`);
      damageReason = reason.name;
    }

    const lotNumber = str(row.lotNumber);
    const expiryDate = importDate(row.expiryDate, "Expiry Date");
    const productionDate = importDate(row.productionDate, "Production Date");
    // A product that does not track an attribute never gets one (see findUntrackedAttributeBuckets).
    if (lotNumber && !product.trackLot) fail(`${sku} doesn't track lot/batch numbers; leave Lot Number empty or turn tracking on first`);
    if (expiryDate && !product.trackExpiry) fail(`${sku} doesn't track expiry dates; leave Expiry Date empty or turn tracking on first`);
    if (productionDate && !product.trackProductionDate) fail(`${sku} doesn't track production dates; leave Production Date empty or turn tracking on first`);
    if (lotNumber && !isValidLot(lotNumber)) fail(`Lot Number "${lotNumber}": ${LOT_MESSAGE}`);
    if (product.trackLot && !lotNumber) fail(`${sku} tracks lot/batch numbers; Lot Number is required`);
    if (product.trackExpiry && !expiryDate) fail(`${sku} tracks expiry dates; Expiry Date is required`);
    if (product.trackProductionDate && !productionDate) fail(`${sku} tracks production dates; Production Date is required`);

    const reason = (await db.select({ id: schema.lookupValues.id }).from(schema.lookupValues)
      .where(and(eq(schema.lookupValues.type, "adjustment_reason"), eq(schema.lookupValues.name, IMPORT_REASON_NAME),
        or(isNull(schema.lookupValues.warehouseId), eq(schema.lookupValues.warehouseId, wh.id)))).limit(1))[0];
    const domainCtx = { userId: ctx.actor.userId, source: ctx.actor.source, scope: auth.scope };
    await explainSkuRule(db, { locationId: location.id, lpId, productId: product.id });
    const units = qty * (await packRatio(db, product.id, packType));
    const { bucket } = await ledger.add(db, domainCtx, {
      warehouseId: wh.id, clientId: client.id, productId: product.id, locationId: location.id, lpId,
      lotNumber, expiryDate, productionDate, damageReason, packType, qty: units, type: "Inventory Adjustment",
      refs: { adjustmentReasonId: reason?.id ?? null, note: `${IMPORT_REASON_NAME} (row ${ctx.rowNumber})` },
    });
    return { entityId: bucket.id, message: `Added ${units} × ${sku} to ${location.code}${lpNumber ? ` / ${lpNumber}` : ""}` };
  },
};
