/**
 * The caller's own activity feeds (BUILD_PLAN F7): notifications (header bell) and
 * background tasks (header Transactions tray and Export History). Rows of other users
 * are never visible (NOT_FOUND).
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { BG_TASK_KINDS, BG_TASK_STATUSES } from "@/lib/enums";
import type { AppDb } from "@/server/api/db";
import { notFoundError, validationError } from "@/server/api/errors";
import { backgroundTasks, files, notifications } from "@/server/db/schema";
import { idSchema, offsetFor, pagingSchema, type Paged } from "./platform-common";

/* ----------------------------------------------------------- notifications */

export type NotificationRow = typeof notifications.$inferSelect;

export const notificationListQuerySchema = pagingSchema.extend({
  unread: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export const notificationReadSchema = z.object({
  ids: z.array(idSchema).min(1).max(1000).optional(),
  all: z.literal(true).optional(),
}).refine((b) => (b.ids === undefined) !== (b.all === undefined), "Send either ids or all: true");

export function listNotifications(
  db: AppDb,
  userId: string,
  query: z.output<typeof notificationListQuerySchema>,
): Paged<NotificationRow> & { readonly unread: number } {
  const mine = eq(notifications.userId, userId);
  const where = query.unread ? and(mine, isNull(notifications.readAt)) : mine;
  const count = (w: ReturnType<typeof and>): number => db.select({ n: sql<number>`count(*)` }).from(notifications).where(w).get()?.n ?? 0;
  const rows = db.select().from(notifications).where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(query.ps).offset(offsetFor(query.page, query.ps)).all();
  return { rows, total: count(where), unread: count(and(mine, isNull(notifications.readAt))) };
}

export function markNotificationsRead(db: AppDb, userId: string, input: z.output<typeof notificationReadSchema>, now: Date = new Date()): { updated: number } {
  if (!input.all && !input.ids) throw validationError("Send either ids or all: true");
  const where = and(
    eq(notifications.userId, userId),
    isNull(notifications.readAt),
    input.ids ? inArray(notifications.id, [...new Set(input.ids)]) : undefined,
  );
  const updated = db.update(notifications).set({ readAt: now.toISOString() }).where(where).run().changes;
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

export function listBackgroundTasks(db: AppDb, userId: string, query: z.output<typeof backgroundTaskListQuerySchema>): Paged<BackgroundTaskView> {
  const where = and(
    eq(backgroundTasks.userId, userId),
    query.kind ? eq(backgroundTasks.kind, query.kind) : undefined,
    query.status ? eq(backgroundTasks.status, query.status) : undefined,
  );
  const total = db.select({ n: sql<number>`count(*)` }).from(backgroundTasks).where(where).get()?.n ?? 0;
  const rows = db.select(taskColumns).from(backgroundTasks).leftJoin(files, eq(files.id, backgroundTasks.fileId))
    .where(where).orderBy(desc(backgroundTasks.createdAt), desc(backgroundTasks.id))
    .limit(query.ps).offset(offsetFor(query.page, query.ps)).all();
  return { rows, total };
}

export function getBackgroundTask(db: AppDb, userId: string, id: string): BackgroundTaskView {
  const row = db.select(taskColumns).from(backgroundTasks).leftJoin(files, eq(files.id, backgroundTasks.fileId))
    .where(and(eq(backgroundTasks.id, id), eq(backgroundTasks.userId, userId))).get();
  if (!row) throw notFoundError("Background task");
  return row;
}
