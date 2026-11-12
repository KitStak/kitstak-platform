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
export async function create(tx: Tx, ctx: DomainCtx, input: CreateLicensePlateInput): Promise<LicensePlateRow> {
  checkScope(ctx, { warehouseId: input.warehouseId, clientId: input.clientId ?? null }, "Warehouse");
  const type = (await tx.select().from(schema.lpTypes).where(eq(schema.lpTypes.id, input.lpTypeId)).limit(1))[0];
  if (!type || type.warehouseId !== input.warehouseId) throw new DomainError("VALIDATION", "Choose an LP type of this warehouse.");
  if (input.locationId) {
    const loc = (await tx.select({ warehouseId: schema.locations.warehouseId }).from(schema.locations).where(eq(schema.locations.id, input.locationId)).limit(1))[0];
    if (!loc || loc.warehouseId !== input.warehouseId) throw new DomainError("VALIDATION", "Choose a location of this warehouse.");
  }
  const row = (await tx.insert(schema.licensePlates).values({
    number: await nextLpNumber(tx, type.id), warehouseId: input.warehouseId, lpTypeId: type.id, locationId: input.locationId ?? null,
    clientId: input.clientId ?? null, status: "Empty", createdBy: ctx.userId, updatedBy: ctx.userId,
    // A new LP starts with its type's dimensions and empty weight (facility-config REQ-R9-2).
    length: type.length, width: type.width, height: type.height, weight: type.emptyWeight,
    actualVolume: type.length * type.width * type.height,
  }).returning())[0];
  await recordCreate(tx, ctx, { entityType: "license_plate", entityId: row.id, entityCode: row.number });
  return row;
}
