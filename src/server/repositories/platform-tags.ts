/**
 * Tags (BUILD_PLAN F7 `/api/tags`): definitions plus bulk apply/remove on records.
 * Tag rows are global reference data; applying a tag is checked per record through the
 * entity registry (permission + scope, cross-scope → per-id NOT_FOUND).
 */
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { TAG_SCOPES } from "@/lib/enums";
import type { AppDb } from "@/server/api/db";
import { AppError, forbiddenError, notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { canAny } from "@/server/auth/permissions";
import { entityTags, tags } from "@/server/db/schema";
import { runBulk } from "@/server/domain/bulk";
import type { BulkResult } from "@/server/domain/types";
import { assertVersion, bulkIdsSchema, entityTypeSchema, idSchema, versionSchema } from "./platform-common";
import { canOnEntity, getEntityDef, requireEntity } from "./platform-entities";

export type TagRow = typeof tags.$inferSelect;

/** Who may create, rename or delete tag definitions. */
export const TAG_MANAGE_PERMISSIONS: readonly string[] = [
  "fulfillment.shipment_orders.tag",
  "inventory.purchase_orders.tag",
  "inventory.return_orders.tag",
  "inventory.work_orders.tag",
  "settings.product_listing.tag",
  "settings.product_listing.manage_tags",
];

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const tagListQuerySchema = z.object({
  scope: z.enum(TAG_SCOPES).optional(),
  q: z.string().trim().max(100).optional(),
});

export const tagCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  color: z.string().regex(COLOR_RE, "Use a hex color like #1A2B3C"),
  scope: z.enum(TAG_SCOPES).default("any"),
});

export const tagUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().regex(COLOR_RE, "Use a hex color like #1A2B3C").optional(),
  version: versionSchema.optional(),
});

export const tagApplySchema = z
  .object({
    entityType: entityTypeSchema,
    ids: bulkIdsSchema,
    tagIds: z.array(idSchema).max(50),
    /** "set" replaces the record's tags with `tagIds` (an empty list clears them). */
    mode: z.enum(["add", "remove", "set"], { message: "Choose add, remove or set" }),
  })
  .refine((v) => v.mode === "set" || v.tagIds.length > 0, { path: ["tagIds"], message: "Select at least one tag" });

export type TagApplyInput = z.output<typeof tagApplySchema>;

export function canManageTags(auth: AuthContext): boolean {
  return canAny(auth, TAG_MANAGE_PERMISSIONS);
}

export function listTags(db: AppDb, query: z.output<typeof tagListQuerySchema>): TagRow[] {
  const conds = [
    query.scope ? or(eq(tags.scope, query.scope), eq(tags.scope, "any")) : undefined,
    query.q ? sql`lower(${tags.name}) LIKE ${`%${query.q.toLowerCase().replace(/[%_\\]/g, "")}%`}` : undefined,
  ].filter((c) => c !== undefined);
  return db.select().from(tags).where(conds.length ? and(...conds) : undefined).orderBy(asc(tags.name)).all();
}

function assertUniqueName(db: AppDb, name: string, scope: TagRow["scope"], exceptId?: string): void {
  const clash = db.select({ id: tags.id }).from(tags)
    .where(and(sql`lower(${tags.name}) = ${name.toLowerCase()}`, eq(tags.scope, scope))).get();
  if (clash && clash.id !== exceptId) {
    throw new AppError("DUPLICATE", `A tag named "${name}" already exists`, { fieldErrors: { name: ["Already exists"] } });
  }
}

export function getTag(db: AppDb, id: string): TagRow {
  const row = db.select().from(tags).where(eq(tags.id, id)).get();
  if (!row) throw notFoundError("Tag");
  return row;
}

export function createTag(db: AppDb, userId: string, input: z.output<typeof tagCreateSchema>): TagRow {
  assertUniqueName(db, input.name, input.scope);
  return db.insert(tags).values({ ...input, createdBy: userId, updatedBy: userId }).returning().get();
}

export function updateTag(db: AppDb, userId: string, id: string, input: z.output<typeof tagUpdateSchema>): TagRow {
  const current = getTag(db, id);
  assertVersion(current.version, input.version);
  if (input.name !== undefined) assertUniqueName(db, input.name, current.scope, id);
  return db.update(tags).set({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
    updatedBy: userId,
    version: current.version + 1,
  }).where(eq(tags.id, id)).returning().get();
}

export function deleteTag(db: AppDb, id: string): { id: string; removedFrom: number } {
  getTag(db, id);
  const removedFrom = db.delete(entityTags).where(eq(entityTags.tagId, id)).run().changes;
  db.delete(tags).where(eq(tags.id, id)).run();
  return { id, removedFrom };
}

/** Tags currently on a record. */
export function tagsForEntity(db: AppDb, entityType: string, entityId: string): TagRow[] {
  return db.select({ tag: tags }).from(entityTags).innerJoin(tags, eq(tags.id, entityTags.tagId))
    .where(and(eq(entityTags.entityType, entityType), eq(entityTags.entityId, entityId)))
    .orderBy(asc(tags.name)).all().map((r) => r.tag);
}

function loadApplicableTags(db: AppDb, entityType: string, tagIds: readonly string[]): TagRow[] {
  const unique = [...new Set(tagIds)];
  const rows = db.select().from(tags).where(inArray(tags.id, unique)).all();
  if (rows.length !== unique.length) throw notFoundError("Tag");
  const wrong = rows.find((t) => t.scope !== "any" && t.scope !== entityType);
  if (wrong) {
    throw new AppError("VALIDATION", `Tag "${wrong.name}" cannot be used on ${getEntityDef(entityType)?.label ?? entityType} records`, {
      fieldErrors: { tagIds: ["Tag scope does not match"] },
    });
  }
  return rows;
}

/** Bulk add/remove: per-id result; each record runs in its own savepoint. */
export function applyTags(db: AppDb, auth: AuthContext, input: TagApplyInput): BulkResult {
  if (!canOnEntity(auth, input.entityType, "tag")) throw forbiddenError();
  const applicable = input.tagIds.length > 0 ? loadApplicableTags(db, input.entityType, input.tagIds) : [];
  return runBulk(db, input.ids, (tx, id) => {
    requireEntity(tx, auth, input.entityType, id, "tag");
    if (input.mode === "set") {
      tx.delete(entityTags).where(and(eq(entityTags.entityType, input.entityType), eq(entityTags.entityId, id))).run();
      for (const tag of applicable) tx.insert(entityTags).values({ tagId: tag.id, entityType: input.entityType, entityId: id }).onConflictDoNothing().run();
      return;
    }
    for (const tag of applicable) {
      if (input.mode === "add") {
        tx.insert(entityTags).values({ tagId: tag.id, entityType: input.entityType, entityId: id }).onConflictDoNothing().run();
      } else {
        tx.delete(entityTags).where(and(eq(entityTags.tagId, tag.id), eq(entityTags.entityType, input.entityType), eq(entityTags.entityId, id))).run();
      }
    }
  });
}
