/**
 * Change log reader (BUILD_PLAN F7 `GET /api/change-log`): field-level rows for one record,
 * including its line-level entries (parentEntityType/parentEntityId), newest first.
 * Access is checked through the owning record (permission + scope). A deleted record keeps
 * its history: the stored Delete row's warehouse parent authorises the read.
 */
import { and, eq, or, sql } from 'drizzle-orm';
import { desc } from '@/server/db/order';
import { z } from 'zod';
import type { AppDb } from '@/server/api/db';
import { forbiddenError, notFoundError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { canAny } from '@/server/auth/permissions';
import { assertInScope } from '@/server/auth/scope';
import { changeLog } from '@/server/db/schema';
import { CHANGE_TYPES } from '@/lib/enums';
import { entityRefSchema, offsetFor, pagingSchema, type Paged } from './platform-common';
import { findEntity, getEntityDef } from './platform-entities';

export type ChangeLogRow = typeof changeLog.$inferSelect & {
  /** Display name of the acting user (falls back to the stored source). */
  readonly userName?: string | null;
};

export const changeLogQuerySchema = entityRefSchema.extend(pagingSchema.shape).extend({
  type: z.enum(CHANGE_TYPES).optional(),
  includeLines: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type ChangeLogQuery = z.output<typeof changeLogQuerySchema>;

/**
 * Permission + scope for reading a record's change log. When the record row is gone, its
 * stored Delete row decides: the history stays readable, scoped by the Delete row's
 * warehouse parent (`parent_entity_type = 'warehouse'`); without one the permission check
 * alone applies.
 */
export async function authorizeChangeLog(
  db: AppDb,
  auth: AuthContext,
  entityType: string,
  entityId: string,
): Promise<void> {
  const d = getEntityDef(entityType);
  if (!d) throw notFoundError('Record');
  if (!canAny(auth, d.permissions.changeLog)) throw forbiddenError();
  const ref = await findEntity(db, entityType, entityId);
  if (ref) {
    assertInScope(auth.scope, ref, d.label);
    return;
  }
  const deleted = (
    await db
      .select({ parentType: changeLog.parentEntityType, parentId: changeLog.parentEntityId })
      .from(changeLog)
      .where(
        and(
          eq(changeLog.entityType, entityType),
          eq(changeLog.entityId, entityId),
          eq(changeLog.type, 'Delete'),
        ),
      )
      .orderBy(desc(changeLog.at))
      .limit(1)
  )[0];
  if (!deleted) throw notFoundError(d.label);
  const warehouseId = deleted.parentType === 'warehouse' ? deleted.parentId : null;
  assertInScope(auth.scope, { warehouseId, clientId: null }, d.label);
}

export async function listChangeLog(
  db: AppDb,
  auth: AuthContext,
  query: ChangeLogQuery,
): Promise<Paged<ChangeLogRow>> {
  await authorizeChangeLog(db, auth, query.entityType, query.entityId);
  const own = and(eq(changeLog.entityType, query.entityType), eq(changeLog.entityId, query.entityId));
  const lines = and(
    eq(changeLog.parentEntityType, query.entityType),
    eq(changeLog.parentEntityId, query.entityId),
  );
  const where = and(
    query.includeLines ? or(own, lines) : own,
    query.type ? eq(changeLog.type, query.type) : undefined,
  );
  const total =
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(changeLog)
        .where(where)
        .limit(1)
    )[0]?.n ?? 0;
  // Ties on `at` (one write: a record and its lines in the same millisecond) read in insert
  // order, so "Purchase Order … is created." comes before each line's create row; a Delete
  // still leads its millisecond (it is always the record's last event).
  const rows = (
    await db
      .select({
        row: changeLog,
        userName: sql<string | null>`(SELECT u.name FROM users u WHERE u.id = ${changeLog.userId})`,
      })
      .from(changeLog)
      .where(where)
      .orderBy(desc(changeLog.at), sql`(${changeLog.type} = 'Delete') DESC`, sql`${changeLog}.rowid ASC`)
      .limit(query.ps)
      .offset(offsetFor(query.page, query.ps))
  ).map(({ row, userName }) => ({ ...row, userName }));
  return { rows, total };
}
