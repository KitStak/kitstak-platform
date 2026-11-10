/**
 * Data Setup lookup tables (BUILD_PLAN F7 `/api/lookups/[type]`): PO/SO types, damage and
 * cancel reasons, product groups, zones, etc. A value is global (no client/warehouse) or
 * scoped to one client and/or warehouse. Reads return global values plus those inside
 * the caller's scope; writes need `settings.data_setup.view` (the catalog's single
 * Data Setup key) and write `change_log` rows.
 */
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { LOOKUP_TYPES, type LookupType } from "@/lib/enums";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError, validationError } from "@/server/api/errors";
import { hasClient, hasWarehouse, type Scope } from "@/server/auth/scope";
import { lookupValues } from "@/server/db/schema";
import { recordCreate, recordDelete, recordUpdate } from "@/server/domain/change-log";
import type { DomainCtx } from "@/server/domain/types";
import { assertVersion, idSchema, likeEscape, versionSchema } from "./platform-common";

export type LookupRow = typeof lookupValues.$inferSelect;
export type ScopedCtx = DomainCtx & { readonly scope: Scope };

export const LOOKUP_MANAGE_PERMISSION = "settings.data_setup.view";
const ENTITY_TYPE = "lookup_value";

export const lookupTypeParamsSchema = z.object({ type: z.enum(LOOKUP_TYPES) });
export const lookupItemParamsSchema = lookupTypeParamsSchema.extend({ id: idSchema });

export const lookupListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  clientId: idSchema.optional(),
  warehouseId: idSchema.optional(),
  includeInactive: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

const MAX_META_CHARS = 4000;
const metaSchema = z.record(z.string().max(60), z.unknown())
  .refine((m) => JSON.stringify(m).length <= MAX_META_CHARS, "Settings are too large");

export const lookupCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  code: z.string().trim().max(60).nullish(),
  clientId: idSchema.nullish(),
  warehouseId: idSchema.nullish(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  meta: metaSchema.nullish(),
});

export const lookupUpdateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120).optional(),
  code: z.string().trim().max(60).nullish(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  meta: metaSchema.nullish(),
  version: versionSchema.optional(),
});

/** Global rows plus rows whose client/warehouse fall inside `scope`. */
function visibleIn(scope: Scope): SQL | undefined {
  const wh = scope.warehouseIds.length
    ? or(isNull(lookupValues.warehouseId), inArray(lookupValues.warehouseId, [...scope.warehouseIds]))
    : isNull(lookupValues.warehouseId);
  if (scope.clientIds === "all") return wh;
  const client = scope.clientIds.length
    ? or(isNull(lookupValues.clientId), inArray(lookupValues.clientId, [...scope.clientIds]))
    : isNull(lookupValues.clientId);
  return and(wh, client);
}

function inScope(scope: Scope, row: Pick<LookupRow, "clientId" | "warehouseId">): boolean {
  return (!row.warehouseId || hasWarehouse(scope, row.warehouseId)) && (!row.clientId || hasClient(scope, row.clientId));
}

export function listLookups(db: AppDb, scope: Scope, type: LookupType, query: z.output<typeof lookupListQuerySchema>): LookupRow[] {
  const where = and(
    eq(lookupValues.type, type),
    visibleIn(scope),
    query.includeInactive ? undefined : eq(lookupValues.isActive, true),
    query.clientId ? or(isNull(lookupValues.clientId), eq(lookupValues.clientId, query.clientId)) : undefined,
    query.warehouseId ? or(isNull(lookupValues.warehouseId), eq(lookupValues.warehouseId, query.warehouseId)) : undefined,
    query.q ? sql`lower(${lookupValues.name}) LIKE ${likeEscape(query.q.toLowerCase())} ESCAPE '\\'` : undefined,
  );
  return db.select().from(lookupValues).where(where).orderBy(asc(lookupValues.sortOrder), asc(lookupValues.name)).all();
}

export function getLookup(db: AppDb, scope: Scope, type: LookupType, id: string): LookupRow {
  const row = db.select().from(lookupValues).where(and(eq(lookupValues.id, id), eq(lookupValues.type, type))).get();
  if (!row || !inScope(scope, row)) throw notFoundError("Lookup value");
  return row;
}

function assertUnique(db: AppDb, type: LookupType, name: string, clientId: string | null, warehouseId: string | null, exceptId?: string): void {
  const clash = db.select({ id: lookupValues.id }).from(lookupValues).where(and(
    eq(lookupValues.type, type),
    sql`lower(${lookupValues.name}) = ${name.toLowerCase()}`,
    clientId ? eq(lookupValues.clientId, clientId) : isNull(lookupValues.clientId),
    warehouseId ? eq(lookupValues.warehouseId, warehouseId) : isNull(lookupValues.warehouseId),
  )).get();
  if (clash && clash.id !== exceptId) {
    throw new AppError("DUPLICATE", `"${name}" already exists`, { fieldErrors: { name: ["Already exists"] } });
  }
}

export function createLookup(db: AppDb, ctx: ScopedCtx, type: LookupType, input: z.output<typeof lookupCreateSchema>): LookupRow {
  const clientId = input.clientId ?? null;
  const warehouseId = input.warehouseId ?? null;
  if (clientId && !hasClient(ctx.scope, clientId)) throw validationError("Client not found", { clientId: ["Client not found"] });
  if (warehouseId && !hasWarehouse(ctx.scope, warehouseId)) throw validationError("Warehouse not found", { warehouseId: ["Warehouse not found"] });
  assertUnique(db, type, input.name, clientId, warehouseId);
  const row = db.insert(lookupValues).values({
    type, name: input.name, code: input.code ?? null, clientId, warehouseId, isActive: input.isActive,
    sortOrder: input.sortOrder, meta: input.meta ?? null, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  recordCreate(db, ctx, { entityType: ENTITY_TYPE, entityId: row.id, entityCode: row.name });
  return row;
}

export function updateLookup(db: AppDb, ctx: ScopedCtx, type: LookupType, id: string, input: z.output<typeof lookupUpdateSchema>): LookupRow {
  const current = getLookup(db, ctx.scope, type, id);
  assertVersion(current.version, input.version);
  if (input.name !== undefined) assertUnique(db, type, input.name, current.clientId, current.warehouseId, id);
  const updated = db.update(lookupValues).set({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.meta !== undefined ? { meta: input.meta } : {}),
    updatedBy: ctx.userId,
    version: current.version + 1,
  }).where(eq(lookupValues.id, id)).returning().get();
  recordUpdate(db, ctx, { entityType: ENTITY_TYPE, entityId: id, entityCode: updated.name, before: current, after: updated });
  return updated;
}

export function deleteLookup(db: AppDb, ctx: ScopedCtx, type: LookupType, id: string): { id: string } {
  const current = getLookup(db, ctx.scope, type, id);
  db.delete(lookupValues).where(eq(lookupValues.id, id)).run();
  recordDelete(db, ctx, { entityType: ENTITY_TYPE, entityId: id, entityCode: current.name });
  return { id };
}
