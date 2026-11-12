/**
 * The caller's own activity feeds (BUILD_PLAN F7): notifications (header bell) and
 * background tasks (header Transactions tray and Export History). Rows of other users
 * are never visible (NOT_FOUND).
 */
import { and, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { desc } from "@/server/db/order";
import { z } from "zod";
import { BG_TASK_KINDS, BG_TASK_STATUSES } from "@/lib/enums";
import type { AppDb } from "@/server/api/db";
import { notFoundError, validationError } from "@/server/api/errors";
import { backgroundTasks, files, notifications } from "@/server/db/schema";
import { idSchema, offsetFor, pagingSchema, type Paged } from "./platform-common";
import { effectiveSeverity, fixPlurals, kindGroup, matchesSeverity, notificationFilterSchema, sinceIso, type NotificationDeleteSchemaOut, type NotificationSeverity } from "@/lib/grid-defs/admin/notifications";
import { rowCount } from "@/server/db/sql";

/* ----------------------------------------------------------- notifications */

export type NotificationRow = typeof notifications.$inferSelect;

export const notificationListQuerySchema = pagingSchema.merge(notificationFilterSchema);

export const notificationReadSchema = z.object({
  ids: z.array(idSchema).min(1).max(1000).optional(),
  all: z.literal(true).optional(),
}).refine((b) => (b.ids === undefined) !== (b.all === undefined), "Send either ids or all: true");

export async function listNotifications(
  db: AppDb,
  userId: string,
  query: z.output<typeof notificationListQuerySchema>,
): Promise<Paged<NotificationRow> & { readonly unread: number; readonly types: readonly string[] }> {
  const mine = eq(notifications.userId, userId);
  const since = sinceIso(query.since);
  const where = and(
    mine,
    query.unread ? isNull(notifications.readAt) : undefined,
    since ? gte(notifications.createdAt, since) : undefined,
    query.type ? sql`(${notifications.kind} = ${query.type} OR ${notifications.kind} ILIKE ${`${query.type}.%`})` : undefined,
  );
  const count = async (w: ReturnType<typeof and>): Promise<number> => (await db.select({ n: sql<number>`count(*)` }).from(notifications).where(w).limit(1))[0]?.n ?? 0;
  const unread = await count(and(mine, isNull(notifications.readAt)));
  const types = [...new Set((await db.selectDistinct({ kind: notifications.kind }).from(notifications).where(mine)).map((r) => kindGroup(r.kind)))].sort();
  if (query.severity === "all") {
    const rows = (await db.select().from(notifications).where(where)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(query.ps).offset(offsetFor(query.page, query.ps))).map(presentNotification);
    return { rows, total: await count(where), unread, types };
  }
  // Effective severity is derived from the copy, so this filter runs in memory (bounded per user).
  const matching = (await db.select().from(notifications).where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(MAX_FILTER_SCAN))
    .map(presentNotification).filter((n) => matchesSeverity(query.severity, n.severity));
  const start = offsetFor(query.page, query.ps);
  return { rows: matching.slice(start, start + query.ps), total: matching.length, unread, types };
}

const MAX_FILTER_SCAN = 5000;

/** Display form: effective severity (a "success" wave with shortages is a warning) and fixed plurals. */
export function presentNotification(n: NotificationRow): NotificationRow {
  const title = fixPlurals(n.title);
  const body = n.body === null ? null : fixPlurals(n.body);
  return { ...n, title, body, severity: effectiveSeverity(n.severity as NotificationSeverity, title, body) };
}

/** Deletes the caller's notifications by id, or every read one. Other users' rows are never touched. */
export async function deleteNotifications(db: AppDb, userId: string, input: NotificationDeleteSchemaOut): Promise<{ deleted: number }> {
  const where = and(
    eq(notifications.userId, userId),
    input.ids ? inArray(notifications.id, [...new Set(input.ids)]) : isNotNull(notifications.readAt),
  );
  return { deleted: rowCount(await db.delete(notifications).where(where)) };
}

export async function markNotificationsRead(db: AppDb, userId: string, input: z.output<typeof notificationReadSchema>, now: Date = new Date()): Promise<{ updated: number }> {
  if (!input.all && !input.ids) throw validationError("Send either ids or all: true");
  const where = and(
    eq(notifications.userId, userId),
    isNull(notifications.readAt),
    input.ids ? inArray(notifications.id, [...new Set(input.ids)]) : undefined,
  );
  const updated = rowCount(await db.update(notifications).set({ readAt: now.toISOString() }).where(where));
  return { updated };
}

/* -------------------------------------------------------- background tasks */

export const backgroundTaskListQuerySchema = pagingSchema.extend({
  kind: z.enum(BG_TASK_KINDS).optional(),
  status: z.enum(BG_TASK_STATUSES).optional(),
});

const taskColumns = {
  id: backgroundTasks.id,
  kind: backgroundTasks.kind,
  title: backgroundTasks.title,
  gridKey: backgroundTasks.gridKey,
  status: backgroundTasks.status,
  progress: backgroundTasks.progress,
  rowCount: backgroundTasks.rowCount,
  errorMessage: backgroundTasks.errorMessage,
  fileId: backgroundTasks.fileId,
  fileName: files.name,
  createdAt: backgroundTasks.createdAt,
  finishedAt: backgroundTasks.finishedAt,
};

export interface BackgroundTaskView {
  readonly id: string;
  readonly kind: (typeof BG_TASK_KINDS)[number];
  readonly title: string;
  readonly gridKey: string | null;
  readonly status: (typeof BG_TASK_STATUSES)[number];
  readonly progress: number;
  readonly rowCount: number | null;
  readonly errorMessage: string | null;
  readonly fileId: string | null;
  readonly fileName: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

export async function listBackgroundTasks(db: AppDb, userId: string, query: z.output<typeof backgroundTaskListQuerySchema>): Promise<Paged<BackgroundTaskView>> {
  const where = and(
    eq(backgroundTasks.userId, userId),
    query.kind ? eq(backgroundTasks.kind, query.kind) : undefined,
    query.status ? eq(backgroundTasks.status, query.status) : undefined,
  );
  const total = (await db.select({ n: sql<number>`count(*)` }).from(backgroundTasks).where(where).limit(1))[0]?.n ?? 0;
  const rows = await db.select(taskColumns).from(backgroundTasks).leftJoin(files, eq(files.id, backgroundTasks.fileId))
    .where(where).orderBy(desc(backgroundTasks.createdAt), desc(backgroundTasks.id))
    .limit(query.ps).offset(offsetFor(query.page, query.ps));
  return { rows, total };
}

export async function getBackgroundTask(db: AppDb, userId: string, id: string): Promise<BackgroundTaskView> {
  const row = (await db.select(taskColumns).from(backgroundTasks).leftJoin(files, eq(files.id, backgroundTasks.fileId))
    .where(and(eq(backgroundTasks.id, id), eq(backgroundTasks.userId, userId))).limit(1))[0];
  if (!row) throw notFoundError("Background task");
  return row;
}
