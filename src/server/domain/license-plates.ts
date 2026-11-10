/**
 * License plates (docs/requests/inbound-receiving.md REQ-2): auto-numbered LP creation for
 * flows such as Receive Items "create new LP from an LP type". Tables belong to M10; this is
 * the shared write path so modules do not insert `license_plates` rows themselves.
 *
 *   import { licensePlates } from "@/server/domain";
 *   licensePlates.create(tx, ctx, { warehouseId, lpTypeId, locationId, clientId });
 */
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { recordCreate } from "./change-log";
import { DomainError } from "./errors";
import { nextLpNumber } from "./sequences";
import { checkScope, type DomainCtx, type Tx } from "./types";

export type LicensePlateRow = typeof schema.licensePlates.$inferSelect;

export interface CreateLicensePlateInput {
  readonly warehouseId: string;
  readonly lpTypeId: string;
  readonly locationId?: string | null;
  readonly clientId?: string | null;
}

/** Creates an Empty LP numbered from its LP type's sequence and writes a change_log Create row. */
export function create(tx: Tx, ctx: DomainCtx, input: CreateLicensePlateInput): LicensePlateRow {
  checkScope(ctx, { warehouseId: input.warehouseId, clientId: input.clientId ?? null }, "Warehouse");
  const type = tx.select().from(schema.lpTypes).where(eq(schema.lpTypes.id, input.lpTypeId)).get();
  if (!type || type.warehouseId !== input.warehouseId) throw new DomainError("VALIDATION", "Choose an LP type of this warehouse.");
  if (input.locationId) {
    const loc = tx.select({ warehouseId: schema.locations.warehouseId }).from(schema.locations).where(eq(schema.locations.id, input.locationId)).get();
    if (!loc || loc.warehouseId !== input.warehouseId) throw new DomainError("VALIDATION", "Choose a location of this warehouse.");
  }
  const row = tx.insert(schema.licensePlates).values({
    number: nextLpNumber(tx, type.id), warehouseId: input.warehouseId, lpTypeId: type.id, locationId: input.locationId ?? null,
    clientId: input.clientId ?? null, status: "Empty", createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  recordCreate(tx, ctx, { entityType: "license_plate", entityId: row.id, entityCode: row.number });
  return row;
}
