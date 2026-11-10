/**
 * Change log reader (BUILD_PLAN F7 `GET /api/change-log`): field-level rows for one record,
 * including its line-level entries (parentEntityType/parentEntityId), newest first.
 * Access is checked through the owning record (permission + scope).
 */
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/server/api/db";
import type { AuthContext } from "@/server/auth/context";
import { changeLog } from "@/server/db/schema";
import { CHANGE_TYPES } from "@/lib/enums";
import { entityRefSchema, offsetFor, pagingSchema, type Paged } from "./platform-common";
import { requireEntity } from "./platform-entities";

export type ChangeLogRow = typeof changeLog.$inferSelect;

export const changeLogQuerySchema = entityRefSchema.extend(pagingSchema.shape).extend({
  type: z.enum(CHANGE_TYPES).optional(),
  includeLines: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
});

export type ChangeLogQuery = z.output<typeof changeLogQuerySchema>;

export function listChangeLog(db: AppDb, auth: AuthContext, query: ChangeLogQuery): Paged<ChangeLogRow> {
  requireEntity(db, auth, query.entityType, query.entityId, "changeLog");
  const own = and(eq(changeLog.entityType, query.entityType), eq(changeLog.entityId, query.entityId));
  const lines = and(eq(changeLog.parentEntityType, query.entityType), eq(changeLog.parentEntityId, query.entityId));
  const where = and(query.includeLines ? or(own, lines) : own, query.type ? eq(changeLog.type, query.type) : undefined);
  const total = db.select({ n: sql<number>`count(*)` }).from(changeLog).where(where).get()?.n ?? 0;
  const rows = db.select().from(changeLog).where(where)
    .orderBy(desc(changeLog.at), desc(changeLog.id))
    .limit(query.ps).offset(offsetFor(query.page, query.ps)).all();
  return { rows, total };
}
