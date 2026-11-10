/**
 * Import applier for "lp-numbers" (M10). Each row is a custom LP number created through
 * `createLpNumbers` (method "custom"), so it gets the same uniqueness checks, receiving-
 * location default and change_log row as the Create LP Number drawer.
 */
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@/server/api/errors";
import * as s from "@/server/db/schema";
import type { ImportApplyContext, ImportApplyResult, ImportRowValues } from "@/server/imports/types";
import { lpCreateSchema } from "@/lib/grid-defs/facility/lp-numbers";
import { cell, findWarehouseByCode } from "./locations-import";
import { createLpNumbers } from "./lp-numbers";

const truthy = (v: unknown): boolean => v === true || ["yes", "true", "1", "y"].includes(cell(v).toLowerCase());

export function applyLpNumberImport(ctx: ImportApplyContext, row: ImportRowValues): ImportApplyResult {
  const { db, auth } = ctx;
  const wh = findWarehouseByCode(db, auth, cell(row.warehouseCode));
  const typeCode = cell(row.lpType);
  const type = db.select({ id: s.lpTypes.id }).from(s.lpTypes).where(and(eq(s.lpTypes.warehouseId, wh.id), sql`lower(${s.lpTypes.code}) = lower(${typeCode})`)).get();
  if (!type) throw new AppError("VALIDATION", `LP type "${typeCode}" not found in ${wh.code}`);
  let locationId: string | null = null;
  const locationCode = cell(row.locationCode);
  if (locationCode) {
    locationId = db.select({ id: s.locations.id }).from(s.locations).where(and(eq(s.locations.warehouseId, wh.id), sql`lower(${s.locations.code}) = lower(${locationCode})`)).get()?.id ?? null;
    if (!locationId) throw new AppError("VALIDATION", `Location "${locationCode}" not found in ${wh.code}`);
  }
  if (truthy(row.isSscc18)) throw new AppError("VALIDATION", "SSCC-18 numbers are issued from the GS1 sequence; create them from Create LP Number > From sequence");
  const parsed = lpCreateSchema.safeParse({
    warehouseId: wh.id, lpTypeId: type.id, locationId, method: "custom", count: null, isSscc18: false, clientId: null,
    number: cell(row.number), alternateBarcode: cell(row.alternateBarcode),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError("VALIDATION", `${issue?.path.join(".") || "row"}: ${issue?.message ?? "invalid"}`);
  }
  const created = createLpNumbers(db, auth, { userId: ctx.actor.userId, source: ctx.actor.source.startsWith("Import · ") ? ctx.actor.source : `Import · ${ctx.actor.source}` }, parsed.data);
  return { entityId: created.ids[0] ?? null, message: `Created LP ${created.numbers[0] ?? ""}` };
}
