/**
 * Home page aggregate (shell module): enriched recents (board kind, item count, group strip),
 * the caller's open work due in a date window, and the latest updates across visible boards.
 * One round trip so the home page paints without a waterfall. Org-scoped + visibility-checked.
 */
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { boards, columns, dashboardWidgets, groups, items, updates, user } from '@/server/db/schema';
import { visibleBoardsPredicate } from './access';
import type { ServiceContext } from './context';
import type { BoardKind } from './contracts/dto';
import { listRecents } from './personal';
import {
  isClosedLabelName,
  isDeadlineColumnTitle,
  pickDueWork,
  type HomeDto,
  type HomeRecentDto,
  type HomeUpdateDto,
  type HomeWorkItemDto,
  type WorkCandidate,
} from './shell-home-model';

export * from './shell-home-model';

const isoDate = z.iso.date();

export const shellHomeQuerySchema = z.object({
  /** Caller's local "today" and end of week (YYYY-MM-DD): the server never guesses timezones. */
  today: isoDate,
  weekEnd: isoDate,
  /** Oldest overdue date still worth surfacing (older work is stale, not "due"). */
  overdueFrom: isoDate,
});
export type ShellHomeQuery = z.infer<typeof shellHomeQuerySchema>;

const RECENT_LIMIT = 8;
const UPDATE_LIMIT = 8;
const WORK_LIMIT = 12;
const MAX_WORK_BOARDS = 40;

interface Label {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly isDone?: boolean;
}

function readLabels(settings: unknown): readonly Label[] {
  const labels = (settings as { labels?: unknown } | null)?.labels;
  return Array.isArray(labels)
    ? labels.filter(
        (label): label is Label =>
          typeof label === 'object' && label !== null && typeof (label as Label).id === 'string',
      )
    : [];
}

async function loadRecents(ctx: ServiceContext): Promise<HomeRecentDto[]> {
  const visits = (await listRecents(ctx, RECENT_LIMIT * 2)).filter(
    (visit) => visit.entityType === 'board' || visit.entityType === 'dashboard',
  );
  const boardIds = visits.filter((visit) => visit.entityType === 'board').map((visit) => visit.entityId);
  const dashboardIds = visits.filter((visit) => visit.entityType === 'dashboard').map((visit) => visit.entityId);

  const [boardRows, countRows, groupRows, groupCountRows, widgetRows] = await Promise.all([
    boardIds.length
      ? ctx.db
          .select({ id: boards.id, kind: boards.kind, terminology: boards.itemTerminology })
          .from(boards)
          .where(and(inArray(boards.id, boardIds), visibleBoardsPredicate(ctx), isNull(boards.archivedAt)))
      : [],
    boardIds.length
      ? ctx.db
          .select({ boardId: items.boardId, total: count() })
          .from(items)
          .where(
            and(
              eq(items.orgId, ctx.orgId),
              inArray(items.boardId, boardIds),
              isNull(items.deletedAt),
              isNull(items.archivedAt),
              isNull(items.parentItemId),
            ),
          )
          .groupBy(items.boardId)
      : [],
    boardIds.length
      ? ctx.db
          .select({
            boardId: groups.boardId,
            groupId: groups.id,
            title: groups.title,
            color: groups.color,
          })
          .from(groups)
          .where(
            and(
              eq(groups.orgId, ctx.orgId),
              inArray(groups.boardId, boardIds),
              isNull(groups.deletedAt),
              isNull(groups.archivedAt),
            ),
          )
          .orderBy(asc(groups.position))
      : [],
    boardIds.length
      ? ctx.db
          .select({ groupId: items.groupId, total: count() })
          .from(items)
          .where(
            and(
              eq(items.orgId, ctx.orgId),
              inArray(items.boardId, boardIds),
              isNull(items.deletedAt),
              isNull(items.archivedAt),
              isNull(items.parentItemId),
            ),
          )
          .groupBy(items.groupId)
      : [],
    dashboardIds.length
      ? ctx.db
          .select({ dashboardId: dashboardWidgets.dashboardId, total: count() })
          .from(dashboardWidgets)
          .where(and(eq(dashboardWidgets.orgId, ctx.orgId), inArray(dashboardWidgets.dashboardId, dashboardIds)))
          .groupBy(dashboardWidgets.dashboardId)
      : [],
  ]);
  const boardById = new Map(boardRows.map((row) => [row.id, row]));
  const countByBoard = new Map(countRows.map((row) => [row.boardId, Number(row.total)]));
  const widgetsByDashboard = new Map(widgetRows.map((row) => [row.dashboardId, Number(row.total)]));
  const countByGroup = new Map(groupCountRows.map((row) => [row.groupId, Number(row.total)]));
  const groupsByBoard = new Map<string, { title: string; color: string; count: number }[]>();
  for (const row of groupRows) {
    const list = groupsByBoard.get(row.boardId) ?? [];
    const entry = { title: row.title, color: row.color, count: countByGroup.get(row.groupId) ?? 0 };
    groupsByBoard.set(row.boardId, [...list, entry]);
  }

  const result: HomeRecentDto[] = [];
  for (const visit of visits) {
    if (visit.entityType === 'board') {
      const board = boardById.get(visit.entityId);
      if (!board) continue;
      result.push({
        entityType: 'board',
        id: visit.entityId,
        name: visit.name,
        workspaceName: visit.workspaceName,
        visitedAt: visit.visitedAt,
        boardKind: board.kind as BoardKind,
        itemTerminology: board.terminology,
        count: countByBoard.get(visit.entityId) ?? 0,
        groups: (groupsByBoard.get(visit.entityId) ?? []).slice(0, 6),
      });
    } else {
      result.push({
        entityType: 'dashboard',
        id: visit.entityId,
        name: visit.name,
        workspaceName: visit.workspaceName,
        visitedAt: visit.visitedAt,
        boardKind: null,
        itemTerminology: null,
        count: widgetsByDashboard.get(visit.entityId) ?? 0,
        groups: [],
      });
    }
    if (result.length >= RECENT_LIMIT) break;
  }
  return result;
}

async function loadWork(ctx: ServiceContext, query: ShellHomeQuery): Promise<HomeWorkItemDto[]> {
  if (!ctx.userId) return [];
  const columnRows = await ctx.db
    .select({
      boardId: columns.boardId,
      key: columns.key,
      title: columns.title,
      type: columns.type,
      settings: columns.settings,
      boardName: boards.name,
      boardKind: boards.kind,
    })
    .from(columns)
    .innerJoin(boards, eq(boards.id, columns.boardId))
    .where(
      and(
        eq(columns.orgId, ctx.orgId),
        isNull(columns.deletedAt),
        eq(columns.scope, 'item'),
        inArray(columns.type, ['people', 'date', 'status']),
        visibleBoardsPredicate(ctx),
        isNull(boards.archivedAt),
      ),
    )
    .orderBy(asc(columns.position));

  const perBoard = new Map<
    string,
    {
      name: string;
      kind: string;
      people: string[];
      date?: string;
      status?: { key: string; labels: readonly Label[] };
      statusIsProgress?: boolean;
    }
  >();
  for (const row of columnRows) {
    const entry = perBoard.get(row.boardId) ?? { name: row.boardName, kind: row.boardKind, people: [] };
    if (row.type === 'people') entry.people = [...entry.people, row.key];
    if (row.type === 'date' && !entry.date && isDeadlineColumnTitle(row.title)) entry.date = row.key;
    if (row.type === 'status') {
      // Prefer the board's progress status (one with a "done" label) over e.g. an activity "Type".
      const labels = readLabels(row.settings);
      const isProgress = labels.some((label) => label.isDone);
      if (!entry.status || (isProgress && !entry.statusIsProgress)) {
        entry.status = { key: row.key, labels };
        entry.statusIsProgress = isProgress;
      }
    }
    perBoard.set(row.boardId, entry);
  }

  const userId = ctx.userId;
  const boardsWithWork = [...perBoard.entries()]
    .filter(([, entry]) => entry.people.length > 0 && entry.date)
    .slice(0, MAX_WORK_BOARDS);

  const candidates = await Promise.all(
    boardsWithWork.map(async ([boardId, entry]) => {
      const assigned = sql.join(
        entry.people.map((key) => sql`(${items.values} -> ${key} -> 'ids') @> ${JSON.stringify([userId])}::jsonb`),
        sql` or `,
      );
      const rows = await ctx.db
        .select({ id: items.id, name: items.name, values: items.values, groupTitle: groups.title, groupColor: groups.color })
        .from(items)
        .innerJoin(groups, eq(groups.id, items.groupId))
        .where(
          and(
            eq(items.orgId, ctx.orgId),
            eq(items.boardId, boardId),
            isNull(items.deletedAt),
            isNull(items.archivedAt),
            isNull(items.parentItemId),
            sql`(${assigned})`,
            sql`(${items.values} -> ${entry.date ?? ''} ->> 'date') <= ${query.weekEnd}`,
            sql`(${items.values} -> ${entry.date ?? ''} ->> 'date') >= ${query.overdueFrom}`,
          ),
        )
        .limit(WORK_LIMIT * 2);
      return rows.map((row): WorkCandidate => {
        const values = row.values as Record<string, unknown>;
        const due = (values[entry.date ?? ''] as { date?: unknown } | undefined)?.date;
        const labelId = entry.status
          ? (values[entry.status.key] as { labelId?: unknown } | undefined)?.labelId
          : undefined;
        const label = entry.status?.labels.find((candidate) => candidate.id === labelId);
        return {
          id: row.id,
          name: row.name,
          boardId,
          boardName: entry.name,
          boardKind: entry.kind as BoardKind,
          groupTitle: row.groupTitle,
          groupColor: row.groupColor,
          dueDate: typeof due === 'string' ? due : '',
          status: label ? { name: label.name, color: label.color } : null,
          done: Boolean(label?.isDone) || isClosedLabelName(label?.name),
        };
      });
    }),
  );
  return pickDueWork(candidates.flat(), query.today, query.weekEnd, WORK_LIMIT);
}

async function loadUpdates(ctx: ServiceContext): Promise<HomeUpdateDto[]> {
  const rows = await ctx.db
    .select({
      id: updates.id,
      body: updates.bodyText,
      createdAt: updates.createdAt,
      itemId: items.id,
      itemName: items.name,
      boardId: boards.id,
      boardName: boards.name,
      authorId: user.id,
      authorName: user.name,
      authorImage: user.image,
    })
    .from(updates)
    .innerJoin(items, eq(items.id, updates.itemId))
    .innerJoin(boards, eq(boards.id, updates.boardId))
    .leftJoin(user, eq(user.id, updates.authorId))
    .where(
      and(
        eq(updates.orgId, ctx.orgId),
        isNull(updates.deletedAt),
        isNull(updates.parentUpdateId),
        isNull(items.deletedAt),
        visibleBoardsPredicate(ctx),
      ),
    )
    .orderBy(desc(updates.createdAt))
    .limit(UPDATE_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    excerpt: row.body.replace(/\s+/g, ' ').trim().slice(0, 220),
    createdAt: row.createdAt.toISOString(),
    itemId: row.itemId,
    itemName: row.itemName,
    boardId: row.boardId,
    boardName: row.boardName,
    author: row.authorId ? { id: row.authorId, name: row.authorName ?? 'Someone', image: row.authorImage } : null,
  }));
}

export async function shellHome(ctx: ServiceContext, query: ShellHomeQuery): Promise<HomeDto> {
  const [recents, work, feed] = await Promise.all([loadRecents(ctx), loadWork(ctx, query), loadUpdates(ctx)]);
  return { recents, work, updates: feed };
}
