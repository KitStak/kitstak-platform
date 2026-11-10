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
import { explainSkuRule } from "@/server/repositories/inventory-commands";
import type { ImportHandler, ImportRowValues } from "../types";

export const IMPORT_REASON_NAME = "Import";

const str = (v: ImportRowValues[string]): string | null => (v === null || v === undefined || v === "" ? null : String(v).trim());

function fail(message: string): never {
  throw new DomainError("VALIDATION", message);
}

export const handler: ImportHandler = {
  configured: true,
  owner: "M06",
  apply(ctx, row) {
    const { db, auth } = ctx;
    const whCode = str(row.warehouseCode) ?? fail("Warehouse Code is required");
    const wh = db.select().from(schema.warehouses).where(eq(schema.warehouses.code, whCode)).get();
    if (!wh || !hasWarehouse(auth.scope, wh.id)) fail(`Warehouse "${whCode}" was not found`);

    const clientCode = str(row.clientCode) ?? fail("Client Code is required");
    const client = db.select().from(schema.clients).where(eq(schema.clients.code, clientCode)).get();
    if (!client || !hasClient(auth.scope, client.id)) fail(`Client "${clientCode}" was not found`);

    const sku = str(row.sku) ?? fail("SKU is required");
    const product = db.select().from(schema.products).where(and(eq(schema.products.clientId, client.id), eq(schema.products.sku, sku))).get();
    if (!product) fail(`SKU "${sku}" was not found for client ${clientCode}`);

    const locCode = str(row.locationCode) ?? fail("Location Code is required");
    const location = db.select().from(schema.locations).where(and(eq(schema.locations.warehouseId, wh.id), eq(schema.locations.code, locCode))).get();
    if (!location) fail(`Location "${locCode}" was not found in ${whCode}`);

    const lpNumber = str(row.lpNumber);
    let lpId: string | null = null;
    if (lpNumber) {
      const lp = db.select().from(schema.licensePlates).where(and(eq(schema.licensePlates.warehouseId, wh.id), eq(schema.licensePlates.number, lpNumber))).get();
      if (!lp) fail(`LP "${lpNumber}" was not found in ${whCode}`);
      lpId = lp.id;
    }

    const packType = str(row.packType) ?? product.uom;
    if (packType !== product.uom) {
      const pack = db.select().from(schema.productPackTypes).where(and(eq(schema.productPackTypes.productId, product.id), eq(schema.productPackTypes.packType, packType))).get();
      if (!pack) fail(`Pack type "${packType}" is not set up for ${sku}`);
    }
    const qty = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
    if (!Number.isInteger(qty) || qty <= 0) fail("Quantity must be a positive whole number");

    const status = str(row.status) ?? "Stock";
    let damageReason = str(row.damageReason);
    if (status !== "Stock" && !damageReason) fail(`Damage Reason is required when Status is ${status}`);
    if (damageReason) {
      const reason = db.select().from(schema.lookupValues)
        .where(and(eq(schema.lookupValues.type, "damage_reason"), eq(schema.lookupValues.name, damageReason))).get();
      if (!reason) fail(`Damage Reason "${damageReason}" is not set up`);
      damageReason = reason.name;
    }

    const lotNumber = str(row.lotNumber);
    const expiryDate = str(row.expiryDate);
    const productionDate = str(row.productionDate);
    if (product.trackLot && !lotNumber) fail(`${sku} tracks lot/batch numbers; Lot Number is required`);
    if (product.trackExpiry && !expiryDate) fail(`${sku} tracks expiry dates; Expiry Date is required`);
    if (product.trackProductionDate && !productionDate) fail(`${sku} tracks production dates; Production Date is required`);

    const reason = db.select({ id: schema.lookupValues.id }).from(schema.lookupValues)
      .where(and(eq(schema.lookupValues.type, "adjustment_reason"), eq(schema.lookupValues.name, IMPORT_REASON_NAME),
        or(isNull(schema.lookupValues.warehouseId), eq(schema.lookupValues.warehouseId, wh.id)))).get();
    const domainCtx = { userId: ctx.actor.userId, source: ctx.actor.source, scope: auth.scope };
    explainSkuRule(db, { locationId: location.id, lpId, productId: product.id });
    const units = qty * packRatio(db, product.id, packType);
    const { bucket } = ledger.add(db, domainCtx, {
      warehouseId: wh.id, clientId: client.id, productId: product.id, locationId: location.id, lpId,
      lotNumber, expiryDate, productionDate, damageReason, packType, qty: units, type: "Inventory Adjustment",
      refs: { adjustmentReasonId: reason?.id ?? null, note: `${IMPORT_REASON_NAME} (row ${ctx.rowNumber})` },
    });
    return { entityId: bucket.id, message: `Added ${units} × ${sku} to ${location.code}${lpNumber ? ` / ${lpNumber}` : ""}` };
  },
};
