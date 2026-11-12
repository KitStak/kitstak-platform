/**
 * Tags (BUILD_PLAN F7 `/api/tags`): definitions plus bulk apply/remove on records.
 * Tag rows are global reference data; applying a tag is checked per record through the
 * entity registry (permission + scope, cross-scope → per-id NOT_FOUND).
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import { z } from 'zod';
import { TAG_SCOPES } from '@/lib/enums';
import type { AppDb } from '@/server/api/db';
import { AppError, forbiddenError, notFoundError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { canAny } from '@/server/auth/permissions';
import { entityTags, tags } from '@/server/db/schema';
import { runBulk } from '@/server/domain/bulk';
import type { BulkResult } from '@/server/domain/types';
import { assertVersion, bulkIdsSchema, entityTypeSchema, idSchema, versionSchema } from './platform-common';
import { canOnEntity, getEntityDef, requireEntity } from './platform-entities';
import { rowCount } from '@/server/db/sql';

export type TagRow = typeof tags.$inferSelect;

/** Who may create, rename or delete tag definitions. */
export const TAG_MANAGE_PERMISSIONS: readonly string[] = [
  'fulfillment.shipment_orders.tag',
  'inventory.purchase_orders.tag',
  'inventory.return_orders.tag',
  'inventory.work_orders.tag',
  'settings.product_listing.tag',
  'settings.product_listing.manage_tags',
];

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const tagListQuerySchema = z.object({
  scope: z.enum(TAG_SCOPES).optional(),
  q: z.string().trim().max(100).optional(),
});

export const tagCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  color: z.string().regex(COLOR_RE, 'Use a hex color like #1A2B3C'),
  scope: z.enum(TAG_SCOPES).default('any'),
});

export const tagUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().regex(COLOR_RE, 'Use a hex color like #1A2B3C').optional(),
  version: versionSchema.optional(),
});

export const tagApplySchema = z
  .object({
    entityType: entityTypeSchema,
    ids: bulkIdsSchema,
    tagIds: z.array(idSchema).max(50),
    /** "set" replaces the record's tags with `tagIds` (an empty list clears them). */
    mode: z.enum(['add', 'remove', 'set'], { message: 'Choose add, remove or set' }),
  })
  .refine((v) => v.mode === 'set' || v.tagIds.length > 0, {
    path: ['tagIds'],
    message: 'Select at least one tag',
  });

export type TagApplyInput = z.output<typeof tagApplySchema>;

export function canManageTags(auth: AuthContext): boolean {
  return canAny(auth, TAG_MANAGE_PERMISSIONS);
}

export async function listTags(db: AppDb, query: z.output<typeof tagListQuerySchema>): Promise<TagRow[]> {
  const conds = [
    query.scope ? or(eq(tags.scope, query.scope), eq(tags.scope, 'any')) : undefined,
    query.q
      ? sql`lower(${tags.name}) ILIKE ${`%${query.q.toLowerCase().replace(/[%_\\]/g, '')}%`}`
      : undefined,
  ].filter((c) => c !== undefined);
  return await db
    .select()
    .from(tags)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(tags.name));
}

async function assertUniqueName(
  db: AppDb,
  name: string,
  scope: TagRow['scope'],
  exceptId?: string,
): Promise<void> {
  const clash = (
    await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(sql`lower(${tags.name}) = ${name.toLowerCase()}`, eq(tags.scope, scope)))
      .limit(1)
  )[0];
  if (clash && clash.id !== exceptId) {
    throw new AppError('DUPLICATE', `A tag named "${name}" already exists`, {
      fieldErrors: { name: ['Already exists'] },
    });
  }
}

export async function getTag(db: AppDb, id: string): Promise<TagRow> {
  const row = (await db.select().from(tags).where(eq(tags.id, id)).limit(1))[0];
  if (!row) throw notFoundError('Tag');
  return row;
}

export async function createTag(
  db: AppDb,
  userId: string,
  input: z.output<typeof tagCreateSchema>,
): Promise<TagRow> {
  await assertUniqueName(db, input.name, input.scope);
  return (
    await db
      .insert(tags)
      .values({ ...input, createdBy: userId, updatedBy: userId })
      .returning()
  )[0];
}

export async function updateTag(
  db: AppDb,
  userId: string,
  id: string,
  input: z.output<typeof tagUpdateSchema>,
): Promise<TagRow> {
  const current = await getTag(db, id);
  assertVersion(current.version, input.version);
  if (input.name !== undefined) await assertUniqueName(db, input.name, current.scope, id);
  return (
    await db
      .update(tags)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        updatedBy: userId,
        version: current.version + 1,
      })
      .where(eq(tags.id, id))
      .returning()
  )[0];
}

export async function deleteTag(db: AppDb, id: string): Promise<{ id: string; removedFrom: number }> {
  await getTag(db, id);
  const removedFrom = rowCount(await db.delete(entityTags).where(eq(entityTags.tagId, id)));
  await db.delete(tags).where(eq(tags.id, id));
  return { id, removedFrom };
}

/** Tags currently on a record. */
export async function tagsForEntity(db: AppDb, entityType: string, entityId: string): Promise<TagRow[]> {
  return (
    await db
      .select({ tag: tags })
      .from(entityTags)
      .innerJoin(tags, eq(tags.id, entityTags.tagId))
      .where(and(eq(entityTags.entityType, entityType), eq(entityTags.entityId, entityId)))
      .orderBy(asc(tags.name))
  ).map((r) => r.tag);
}

async function loadApplicableTags(
  db: AppDb,
  entityType: string,
  tagIds: readonly string[],
): Promise<TagRow[]> {
  const unique = [...new Set(tagIds)];
  const rows = await db.select().from(tags).where(inArray(tags.id, unique));
  if (rows.length !== unique.length) throw notFoundError('Tag');
  const wrong = rows.find((t) => t.scope !== 'any' && t.scope !== entityType);
  if (wrong) {
    throw new AppError(
      'VALIDATION',
      `Tag "${wrong.name}" cannot be used on ${getEntityDef(entityType)?.label ?? entityType} records`,
      {
        fieldErrors: { tagIds: ['Tag scope does not match'] },
      },
    );
  }
  return rows;
}

/** Bulk add/remove: per-id result; each record runs in its own savepoint. */
export async function applyTags(db: AppDb, auth: AuthContext, input: TagApplyInput): Promise<BulkResult> {
  if (!canOnEntity(auth, input.entityType, 'tag')) throw forbiddenError();
  const applicable =
    input.tagIds.length > 0 ? await loadApplicableTags(db, input.entityType, input.tagIds) : [];
  return await runBulk(db, input.ids, async (tx, id) => {
    await requireEntity(tx, auth, input.entityType, id, 'tag');
    if (input.mode === 'set') {
      await tx
        .delete(entityTags)
        .where(and(eq(entityTags.entityType, input.entityType), eq(entityTags.entityId, id)));
      for (const tag of applicable)
        await tx
          .insert(entityTags)
          .values({ tagId: tag.id, entityType: input.entityType, entityId: id })
          .onConflictDoNothing();
      return;
    }
    for (const tag of applicable) {
      if (input.mode === 'add') {
        await tx
          .insert(entityTags)
          .values({ tagId: tag.id, entityType: input.entityType, entityId: id })
          .onConflictDoNothing();
      } else {
        await tx
          .delete(entityTags)
          .where(
            and(
              eq(entityTags.tagId, tag.id),
              eq(entityTags.entityType, input.entityType),
              eq(entityTags.entityId, id),
            ),
          );
      }
    }
  });
}
