/**
 * Command-palette search (shell module). Wraps the global full-text `search()` for items and
 * adds what the palette needs that the generic endpoint does not return: strict matching,
 * the item's board > group breadcrumb with group color, its primary status pill, plus
 * dashboards and people. Every query is org-scoped and honors board / workspace visibility.
 */
import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  boards,
  columns,
  dashboards,
  folders,
  groups,
  items,
  member,
  user,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { visibleBoardsPredicate } from './access';
import { isOrgAdmin, type ServiceContext } from './context';
import type { BoardKind } from './contracts/dto';
import { search } from './search';
import { pickStatusColumn } from './shell-home-model';
import {
  PALETTE_GROUPS,
  allowedPaletteGroups,
  matchesStrictly,
  rankByMatch,
  type PaletteGroup,
  type PaletteBoardDto,
  type PaletteDashboardDto,
  type PaletteItemDto,
  type PalettePersonDto,
  type PaletteSearchDto,
  type PaletteWorkspaceDto,
} from './shell-search-model';

export * from './shell-search-model';

export const shellSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(6),
  /** Restrict to one group ("See all" in the palette). */
  type: z.enum(PALETTE_GROUPS).optional(),
});
export type ShellSearchQuery = z.infer<typeof shellSearchQuerySchema>;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Workspaces the caller can see: open ones, ones they belong to, or all for org admins. */
function workspaceVisible(ctx: ServiceContext, workspaceIdColumn: SQL | typeof workspaces.id): SQL {
  if (isOrgAdmin(ctx) || ctx.userId === null) return sql`true`;
  return sql`exists (select 1 from ${workspaces} w where w.id = ${workspaceIdColumn} and w.deleted_at is null and (w.kind = 'open' or exists (select 1 from ${workspaceMembers} wm where wm.workspace_id = w.id and wm.user_id = ${ctx.userId})))`;
}

interface StatusLabel {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly isDone?: boolean;
}

function readLabels(settings: unknown): readonly StatusLabel[] {
  const labels = (settings as { labels?: unknown } | null)?.labels;
  if (!Array.isArray(labels)) return [];
  return labels.filter(
    (label): label is StatusLabel =>
      typeof label === 'object' &&
      label !== null &&
      typeof (label as StatusLabel).id === 'string' &&
      typeof (label as StatusLabel).name === 'string' &&
      typeof (label as StatusLabel).color === 'string',
  );
}

async function searchItems(ctx: ServiceContext, query: ShellSearchQuery): Promise<PaletteItemDto[]> {
  const hits = await search(ctx, { q: query.q, types: ['item'], limit: Math.min(50, Math.max(30, query.limit * 3)) });
  const seen = new Set<string>();
  const strict = hits.filter((hit) => {
    if (hit.type !== 'item' || seen.has(hit.id)) return false;
    seen.add(hit.id);
    return matchesStrictly(query.q, hit.title) || matchesStrictly(query.q, hit.snippet ?? '');
  });
  const picked = rankByMatch(query.q, strict, (hit) => hit.title).slice(0, query.limit + 1);
  if (picked.length === 0) return [];

  const ids = picked.map((hit) => hit.id);
  const rows = await ctx.db
    .select({
      id: items.id,
      values: items.values,
      groupTitle: groups.title,
      groupColor: groups.color,
      boardId: boards.id,
      boardName: boards.name,
      boardKind: boards.kind,
      terminology: boards.itemTerminology,
    })
    .from(items)
    .innerJoin(groups, eq(groups.id, items.groupId))
    .innerJoin(boards, eq(boards.id, items.boardId))
    .where(and(eq(items.orgId, ctx.orgId), inArray(items.id, ids)));
  const byId = new Map(rows.map((row) => [row.id, row]));

  const boardIds = [...new Set(rows.map((row) => row.boardId))];
  const statusColumns =
    boardIds.length === 0
      ? []
      : await ctx.db
          .select({ boardId: columns.boardId, key: columns.key, title: columns.title, settings: columns.settings })
          .from(columns)
          .where(
            and(
              eq(columns.orgId, ctx.orgId),
              inArray(columns.boardId, boardIds),
              eq(columns.type, 'status'),
              eq(columns.scope, 'item'),
              isNull(columns.deletedAt),
            ),
          )
          .orderBy(asc(columns.position));
  const columnsByBoard = new Map<string, { key: string; title: string; labels: readonly StatusLabel[] }[]>();
  for (const column of statusColumns) {
    const entry = { key: column.key, title: column.title, labels: readLabels(column.settings) };
    columnsByBoard.set(column.boardId, [...(columnsByBoard.get(column.boardId) ?? []), entry]);
  }
  const firstStatus = new Map<string, { key: string; labels: readonly StatusLabel[] }>();
  for (const [boardId, list] of columnsByBoard) {
    const picked = list[pickStatusColumn(list)];
    if (picked) firstStatus.set(boardId, picked);
  }

  return picked.flatMap((hit) => {
    const row = byId.get(hit.id);
    if (!row) return [];
    const status = firstStatus.get(row.boardId);
    const raw = status ? (row.values as Record<string, unknown>)[status.key] : undefined;
    const labelId = (raw as { labelId?: unknown } | undefined)?.labelId;
    const label = status && typeof labelId === 'string' ? status.labels.find((l) => l.id === labelId) : undefined;
    return [
      {
        id: hit.id,
        name: hit.title,
        snippet: matchesStrictly(query.q, hit.title) ? null : hit.snippet,
        boardId: row.boardId,
        boardName: row.boardName,
        boardKind: row.boardKind as BoardKind,
        itemTerminology: row.terminology,
        groupTitle: row.groupTitle,
        groupColor: row.groupColor,
        status: label ? { name: label.name, color: label.color } : null,
      },
    ];
  });
}

async function searchBoards(ctx: ServiceContext, query: ShellSearchQuery): Promise<PaletteBoardDto[]> {
  const like = `%${escapeLike(query.q)}%`;
  const rows = await ctx.db
    .select({
      id: boards.id,
      name: boards.name,
      kind: boards.kind,
      workspaceId: boards.workspaceId,
      workspaceName: workspaces.name,
      folderName: folders.name,
    })
    .from(boards)
    .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
    .leftJoin(folders, eq(folders.id, boards.folderId))
    .where(and(visibleBoardsPredicate(ctx), isNull(boards.archivedAt), ilike(boards.name, like)))
    .limit(query.limit * 3);
  return rankByMatch(query.q, rows, (row) => row.name)
    .slice(0, query.limit + 1)
    .map((row) => ({ ...row, kind: row.kind as BoardKind }));
}

async function searchDashboards(
  ctx: ServiceContext,
  query: ShellSearchQuery,
): Promise<PaletteDashboardDto[]> {
  const like = `%${escapeLike(query.q)}%`;
  const rows = await ctx.db
    .select({
      id: dashboards.id,
      name: dashboards.name,
      workspaceId: dashboards.workspaceId,
      workspaceName: workspaces.name,
    })
    .from(dashboards)
    .leftJoin(workspaces, eq(workspaces.id, dashboards.workspaceId))
    .where(
      and(
        eq(dashboards.orgId, ctx.orgId),
        isNull(dashboards.deletedAt),
        ilike(dashboards.name, like),
        or(isNull(dashboards.workspaceId), workspaceVisible(ctx, sql`${dashboards.workspaceId}`)),
      ),
    )
    .limit(query.limit * 3);
  return rankByMatch(query.q, rows, (row) => row.name).slice(0, query.limit + 1);
}

async function searchPeople(ctx: ServiceContext, query: ShellSearchQuery): Promise<PalettePersonDto[]> {
  const like = `%${escapeLike(query.q)}%`;
  const rows = await ctx.db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      title: user.title,
      role: member.role,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, ctx.orgId), or(ilike(user.name, like), ilike(user.email, like))))
    .limit(query.limit * 3);
  return rankByMatch(query.q, rows, (row) => row.name).slice(0, query.limit + 1);
}

async function searchWorkspaces(
  ctx: ServiceContext,
  query: ShellSearchQuery,
): Promise<PaletteWorkspaceDto[]> {
  const like = `%${escapeLike(query.q)}%`;
  const rows = await ctx.db
    .select({ id: workspaces.id, name: workspaces.name, color: workspaces.color, kind: workspaces.kind })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.orgId, ctx.orgId),
        isNull(workspaces.deletedAt),
        ilike(workspaces.name, like),
        workspaceVisible(ctx, workspaces.id),
      ),
    )
    .limit(query.limit * 3);
  return rankByMatch(query.q, rows, (row) => row.name).slice(0, query.limit + 1);
}

async function none<T>(): Promise<T[]> {
  return [];
}

/**
 * All palette groups in parallel (or only `query.type`). Each group fetches one row past the
 * limit so the palette can offer "See all" without a separate count query.
 */
export async function shellSearch(ctx: ServiceContext, query: ShellSearchQuery): Promise<PaletteSearchDto> {
  const allowed = allowedPaletteGroups(ctx);
  const wants = (group: PaletteGroup) => allowed.has(group) && (!query.type || query.type === group);
  const [itemResults, boardResults, dashboardResults, peopleResults, workspaceResults] = await Promise.all([
    wants('items') ? searchItems(ctx, query) : none<PaletteItemDto>(),
    wants('boards') ? searchBoards(ctx, query) : none<PaletteBoardDto>(),
    wants('dashboards') ? searchDashboards(ctx, query) : none<PaletteDashboardDto>(),
    wants('people') ? searchPeople(ctx, query) : none<PalettePersonDto>(),
    wants('workspaces') ? searchWorkspaces(ctx, query) : none<PaletteWorkspaceDto>(),
  ]);
  const cut = <T,>(rows: readonly T[]) => rows.slice(0, query.limit);
  return {
    query: query.q,
    items: cut(itemResults),
    boards: cut(boardResults),
    dashboards: cut(dashboardResults),
    people: cut(peopleResults),
    workspaces: cut(workspaceResults),
    more: {
      items: itemResults.length > query.limit,
      boards: boardResults.length > query.limit,
      dashboards: dashboardResults.length > query.limit,
      people: peopleResults.length > query.limit,
      workspaces: workspaceResults.length > query.limit,
    },
  };
}
