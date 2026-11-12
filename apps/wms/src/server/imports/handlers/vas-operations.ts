/**
 * Import handler "vas-operations" (owner M11). Each row logs one VAS operation through
 * `createVas` (calculation type from the VAS type, approved-bill lock, change_log). The
 * reference order type is inferred from the code prefix: SO = Shipment Order, PO = Purchase
 * Order, WO = Work Order. The operation date is the import time.
 */
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { VAS_NOTE_MAX, vasSchema } from "@/lib/grid-defs/organization/vas";
import { createVas } from "@/server/repositories/vas";
import type { ImportHandler, ImportRowValues } from "../types";

const str = (v: ImportRowValues[string]): string | null => (v === null || v === undefined || v === "" ? null : String(v).trim());
function fail(message: string): never {
  throw new DomainError("VALIDATION", message);
}

export function referenceTypeOf(code: string | null): "Shipment Order" | "Purchase Order" | "Work Order" | null {
  if (!code) return null;
  if (/^SO/i.test(code)) return "Shipment Order";
  if (/^PO/i.test(code)) return "Purchase Order";
  if (/^WO/i.test(code)) return "Work Order";
  return null;
}

export const handler: ImportHandler = {
  configured: true,
  owner: "M11",
  async apply(ctx, row) {
    const { db, auth, actor } = ctx;
    const whCode = str(row.warehouseCode) ?? fail("Warehouse Code is required");
    const wh = (await db.select({ id: schema.warehouses.id }).from(schema.warehouses).where(eq(schema.warehouses.code, whCode)).limit(1))[0] ?? fail(`Warehouse "${whCode}" was not found`);
    const clientCode = str(row.clientCode) ?? fail("Client Code is required");
    const client = (await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.code, clientCode)).limit(1))[0] ?? fail(`Client "${clientCode}" was not found`);
    const typeName = str(row.vasType) ?? fail("VAS Type is required");
    const type = (await db.select({ id: schema.lookupValues.id }).from(schema.lookupValues)
      .where(and(eq(schema.lookupValues.type, "vas_type"), eq(schema.lookupValues.name, typeName))).limit(1))[0] ?? fail(`VAS type "${typeName}" was not found in Data Setup`);
    const note = str(row.notes);
    if (note && note.length > VAS_NOTE_MAX) fail(`Notes can be at most ${VAS_NOTE_MAX} characters`);
    const reference = str(row.referenceCode);
    const parsed = vasSchema.safeParse({
      clientId: client.id, warehouseId: wh.id, vasTypeId: type.id, operationAt: new Date().toISOString(), value: Number(row.quantity ?? 0), note,
      referenceNumber: reference, referenceOrderType: referenceTypeOf(reference) ?? (reference ? "Shipment Order" : null),
    });
    if (!parsed.success) fail(parsed.error.issues.map((i) => i.message).join("; "));
    const created = await createVas(db, auth, actor, parsed.data);
    return { entityId: created.id, message: `${typeName} x ${parsed.data.value} logged for ${clientCode}` };
  },
};
