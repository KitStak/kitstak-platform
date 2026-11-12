/**
 * Activity log: written for every item / board structure change; powers the item
 * "Activity" tab and the board activity feed.
 */
import { and, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { activityLog, user } from '@/server/db/schema';
import { requireBoard, requireItem } from './access';
import type { ServiceContext } from './context';
import { decodeCursor, encodeCursor, timeIdCursorSchema, toPage, type Page } from './pagination';
import type { ActivityDto } from './contracts/dto';

export interface ActivityInput {
  readonly boardId: string | null;
  readonly itemId?: string | null;
  readonly action: string;
  readonly columnKey?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
}

/** Insert one or many activity rows attributed to the context's user / automation. */
export async function logActivity(
  ctx: ServiceContext,
  entries: ActivityInput | readonly ActivityInput[],
): Promise<void> {
  const list = Array.isArray(entries) ? (entries as readonly ActivityInput[]) : [entries as ActivityInput];
  if (list.length === 0) return;
  const rows = list.map((entry) => ({
    orgId: ctx.orgId,
    boardId: entry.boardId,
    itemId: entry.itemId ?? null,
    actorId: ctx.userId,
    automationId: ctx.automation?.automationId ?? null,
    action: entry.action,
    columnKey: entry.columnKey ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  }));
  for (let start = 0; start < rows.length; start += 500) {
    await ctx.db.insert(activityLog).values(rows.slice(start, start + 500));
  }
}

export const activityQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  actions: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : Array.isArray(value) ? value : value.split(','),
    ),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

async function listActivity(
  ctx: ServiceContext,
  scope: SQL,
  query: ActivityQuery,
): Promise<Page<ActivityDto>> {
  const cursor = decodeCursor(query.cursor, timeIdCursorSchema);
  const conditions: SQL[] = [eq(activityLog.orgId, ctx.orgId), scope];
  if (query.actions?.length) conditions.push(inArray(activityLog.action, query.actions));
  if (cursor) {
    const at = new Date(cursor[0]);
    conditions.push(
      or(
        lt(activityLog.createdAt, at),
        and(eq(activityLog.createdAt, at), lt(activityLog.id, cursor[1])),
      ) as SQL,
    );
  }
  const rows = await ctx.db
    .select({
      id: activityLog.id,
      boardId: activityLog.boardId,
      itemId: activityLog.itemId,
      actorId: activityLog.actorId,
      actorName: user.name,
      actorImage: user.image,
      automationId: activityLog.automationId,
      action: activityLog.action,
      columnKey: activityLog.columnKey,
      before: activityLog.before,
      after: activityLog.after,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .leftJoin(user, eq(user.id, activityLog.actorId))
    .where(and(...conditions))
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    .limit(query.limit + 1);
  const page = toPage(rows, query.limit, (row) => encodeCursor([row.createdAt.toISOString(), row.id]));
  return {
    nextCursor: page.nextCursor,
    items: page.items.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
  };
}

export async function listBoardActivity(
  ctx: ServiceContext,
  boardId: string,
  query: ActivityQuery,
): Promise<Page<ActivityDto>> {
  await requireBoard(ctx, boardId, 'read');
  return listActivity(ctx, eq(activityLog.boardId, boardId), query);
}

export async function listItemActivity(
  ctx: ServiceContext,
  itemId: string,
  query: ActivityQuery,
): Promise<Page<ActivityDto>> {
  await requireItem(ctx, itemId, 'read', { includeDeleted: true });
  return listActivity(ctx, eq(activityLog.itemId, itemId), query);
}
