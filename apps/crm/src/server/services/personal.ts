/** Per-user conveniences: favorites and recently visited entities. */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  boards,
  dashboards,
  favorites,
  folders,
  items,
  recentVisits,
  views,
  workspaces,
} from '@/server/db/schema';
import { ForbiddenError, NotFoundError } from '@/server/http/errors';
import { requireBoard, requireItem, requireWorkspace, visibleBoardsPredicate } from './access';
import type { ServiceContext } from './context';
import type { BoardKind, EntityType, FavoriteDto, RecentVisitDto } from './contracts/dto';
import { positionAfter, resolveMovePosition } from './positions';

export const entityRefSchema = z.object({
  entityType: z.enum(['workspace', 'folder', 'board', 'dashboard', 'item', 'view']),
  entityId: z.uuid(),
});
export type EntityRef = z.infer<typeof entityRefSchema>;

function requireUser(ctx: ServiceContext): string {
  if (!ctx.userId) throw new ForbiddenError();
  return ctx.userId;
}

/** Verify the entity exists in the org and is visible to the caller. */
async function assertEntityVisible(ctx: ServiceContext, ref: EntityRef): Promise<void> {
  switch (ref.entityType) {
    case 'board':
      await requireBoard(ctx, ref.entityId, 'read');
      return;
    case 'item':
      await requireItem(ctx, ref.entityId, 'read');
      return;
    case 'workspace':
      await requireWorkspace(ctx, ref.entityId);
      return;
    case 'folder': {
      const [row] = await ctx.db
        .select({ workspaceId: folders.workspaceId })
        .from(folders)
        .where(and(eq(folders.id, ref.entityId), eq(folders.orgId, ctx.orgId), isNull(folders.deletedAt)))
        .limit(1);
      if (!row) throw new NotFoundError('Folder');
      await requireWorkspace(ctx, row.workspaceId);
      return;
    }
    case 'dashboard': {
      const [row] = await ctx.db
        .select({ id: dashboards.id })
        .from(dashboards)
        .where(
          and(eq(dashboards.id, ref.entityId), eq(dashboards.orgId, ctx.orgId), isNull(dashboards.deletedAt)),
        )
        .limit(1);
      if (!row) throw new NotFoundError('Dashboard');
      return;
    }
    case 'view': {
      const [row] = await ctx.db
        .select({ boardId: views.boardId })
        .from(views)
        .where(and(eq(views.id, ref.entityId), eq(views.orgId, ctx.orgId), isNull(views.deletedAt)))
        .limit(1);
      if (!row) throw new NotFoundError('View');
      await requireBoard(ctx, row.boardId, 'read');
    }
  }
}

interface EntityInfo {
  readonly name: string;
  readonly icon: string | null;
  readonly boardKind: BoardKind | null;
  readonly workspaceId: string | null;
}

/** Names for a heterogeneous entity list (missing / deleted entities are omitted). */
async function describeEntities(
  ctx: ServiceContext,
  refs: readonly EntityRef[],
): Promise<Map<string, EntityInfo>> {
  const byType = (type: EntityType) =>
    refs.filter((ref) => ref.entityType === type).map((ref) => ref.entityId);
  const out = new Map<string, EntityInfo>();
  const boardIds = byType('board');
  if (boardIds.length) {
    const rows = await ctx.db
      .select({
        id: boards.id,
        name: boards.name,
        icon: boards.icon,
        kind: boards.kind,
        workspaceId: boards.workspaceId,
      })
      .from(boards)
      .where(and(inArray(boards.id, boardIds), visibleBoardsPredicate(ctx)));
    for (const row of rows)
      out.set(`board:${row.id}`, {
        name: row.name,
        icon: row.icon,
        boardKind: row.kind,
        workspaceId: row.workspaceId,
      });
  }
  const workspaceIds = byType('workspace');
  if (workspaceIds.length) {
    const rows = await ctx.db
      .select({ id: workspaces.id, name: workspaces.name, icon: workspaces.icon })
      .from(workspaces)
      .where(
        and(
          inArray(workspaces.id, workspaceIds),
          eq(workspaces.orgId, ctx.orgId),
          isNull(workspaces.deletedAt),
        ),
      );
    for (const row of rows)
      out.set(`workspace:${row.id}`, {
        name: row.name,
        icon: row.icon,
        boardKind: null,
        workspaceId: row.id,
      });
  }
  const dashboardIds = byType('dashboard');
  if (dashboardIds.length) {
    const rows = await ctx.db
      .select({ id: dashboards.id, name: dashboards.name, workspaceId: dashboards.workspaceId })
      .from(dashboards)
      .where(
        and(
          inArray(dashboards.id, dashboardIds),
          eq(dashboards.orgId, ctx.orgId),
          isNull(dashboards.deletedAt),
        ),
      );
    for (const row of rows)
      out.set(`dashboard:${row.id}`, {
        name: row.name,
        icon: 'LayoutDashboard',
        boardKind: null,
        workspaceId: row.workspaceId,
      });
  }
  const itemIds = byType('item');
  if (itemIds.length) {
    const rows = await ctx.db
      .select({ id: items.id, name: items.name, workspaceId: boards.workspaceId })
      .from(items)
      .innerJoin(boards, eq(boards.id, items.boardId))
      .where(
        and(
          inArray(items.id, itemIds),
          eq(items.orgId, ctx.orgId),
          isNull(items.deletedAt),
          visibleBoardsPredicate(ctx),
        ),
      );
    for (const row of rows)
      out.set(`item:${row.id}`, {
        name: row.name,
        icon: null,
        boardKind: null,
        workspaceId: row.workspaceId,
      });
  }
  const folderIds = byType('folder');
  if (folderIds.length) {
    const rows = await ctx.db
      .select({ id: folders.id, name: folders.name, workspaceId: folders.workspaceId })
      .from(folders)
      .where(and(inArray(folders.id, folderIds), eq(folders.orgId, ctx.orgId), isNull(folders.deletedAt)));
    for (const row of rows)
      out.set(`folder:${row.id}`, {
        name: row.name,
        icon: 'Folder',
        boardKind: null,
        workspaceId: row.workspaceId,
      });
  }
  const viewIds = byType('view');
  if (viewIds.length) {
    const rows = await ctx.db
      .select({ id: views.id, name: views.name, workspaceId: boards.workspaceId })
      .from(views)
      .innerJoin(boards, eq(boards.id, views.boardId))
      .where(
        and(
          inArray(views.id, viewIds),
          eq(views.orgId, ctx.orgId),
          isNull(views.deletedAt),
          visibleBoardsPredicate(ctx),
        ),
      );
    for (const row of rows)
      out.set(`view:${row.id}`, {
        name: row.name,
        icon: null,
        boardKind: null,
        workspaceId: row.workspaceId,
      });
  }
  return out;
}

export async function listFavorites(ctx: ServiceContext): Promise<FavoriteDto[]> {
  const userId = requireUser(ctx);
  const rows = await ctx.db
    .select()
    .from(favorites)
    .where(and(eq(favorites.orgId, ctx.orgId), eq(favorites.userId, userId)))
    .orderBy(asc(favorites.position));
  const info = await describeEntities(ctx, rows);
  return rows.flatMap((row) => {
    const entity = info.get(`${row.entityType}:${row.entityId}`);
    if (!entity) return [];
    return [
      {
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        name: entity.name,
        position: row.position,
        icon: entity.icon,
        boardKind: entity.boardKind,
        workspaceId: entity.workspaceId,
      },
    ];
  });
}

export async function addFavorite(ctx: ServiceContext, ref: EntityRef): Promise<FavoriteDto[]> {
  const userId = requireUser(ctx);
  await assertEntityVisible(ctx, ref);
  const [last] = await ctx.db
    .select({ position: favorites.position })
    .from(favorites)
    .where(and(eq(favorites.orgId, ctx.orgId), eq(favorites.userId, userId)))
    .orderBy(desc(favorites.position))
    .limit(1);
  await ctx.db
    .insert(favorites)
    .values({
      orgId: ctx.orgId,
      userId,
      entityType: ref.entityType,
      entityId: ref.entityId,
      position: positionAfter(last?.position),
    })
    .onConflictDoNothing();
  return listFavorites(ctx);
}

export async function removeFavorite(ctx: ServiceContext, ref: EntityRef): Promise<FavoriteDto[]> {
  const userId = requireUser(ctx);
  await ctx.db
    .delete(favorites)
    .where(
      and(
        eq(favorites.orgId, ctx.orgId),
        eq(favorites.userId, userId),
        eq(favorites.entityType, ref.entityType),
        eq(favorites.entityId, ref.entityId),
      ),
    );
  return listFavorites(ctx);
}

export const reorderFavoriteSchema = z.object({
  favoriteId: z.uuid(),
  afterId: z.uuid().nullish(),
  beforeId: z.uuid().nullish(),
});

export async function reorderFavorite(
  ctx: ServiceContext,
  input: z.infer<typeof reorderFavoriteSchema>,
): Promise<FavoriteDto[]> {
  const userId = requireUser(ctx);
  const rows = await ctx.db
    .select({ id: favorites.id, position: favorites.position })
    .from(favorites)
    .where(and(eq(favorites.orgId, ctx.orgId), eq(favorites.userId, userId)));
  if (!rows.some((row) => row.id === input.favoriteId)) throw new NotFoundError('Favorite');
  const position = resolveMovePosition(
    rows.filter((row) => row.id !== input.favoriteId),
    input,
  );
  await ctx.db.update(favorites).set({ position }).where(eq(favorites.id, input.favoriteId));
  return listFavorites(ctx);
}

export async function recordVisit(ctx: ServiceContext, ref: EntityRef): Promise<{ ok: true }> {
  const userId = requireUser(ctx);
  await assertEntityVisible(ctx, ref);
  await ctx.db
    .insert(recentVisits)
    .values({ orgId: ctx.orgId, userId, entityType: ref.entityType, entityId: ref.entityId })
    .onConflictDoUpdate({
      target: [recentVisits.userId, recentVisits.entityType, recentVisits.entityId],
      set: { visitedAt: new Date(), visitCount: sql`${recentVisits.visitCount} + 1` },
    });
  return { ok: true };
}

export async function listRecents(ctx: ServiceContext, limit = 20): Promise<RecentVisitDto[]> {
  const userId = requireUser(ctx);
  const rows = await ctx.db
    .select()
    .from(recentVisits)
    .where(and(eq(recentVisits.orgId, ctx.orgId), eq(recentVisits.userId, userId)))
    .orderBy(desc(recentVisits.visitedAt))
    .limit(Math.min(limit, 100) * 2);
  const info = await describeEntities(ctx, rows);
  const workspaceIds = [
    ...new Set(
      [...info.values()].map((entry) => entry.workspaceId).filter((id): id is string => id !== null),
    ),
  ];
  const workspaceNames = new Map(
    workspaceIds.length
      ? (
          await ctx.db
            .select({ id: workspaces.id, name: workspaces.name })
            .from(workspaces)
            .where(inArray(workspaces.id, workspaceIds))
        ).map((row) => [row.id, row.name])
      : [],
  );
  return rows
    .flatMap((row) => {
      const entity = info.get(`${row.entityType}:${row.entityId}`);
      if (!entity) return [];
      return [
        {
          entityType: row.entityType,
          entityId: row.entityId,
          name: entity.name,
          workspaceId: entity.workspaceId,
          workspaceName: entity.workspaceId ? (workspaceNames.get(entity.workspaceId) ?? null) : null,
          visitedAt: row.visitedAt.toISOString(),
          visitCount: row.visitCount,
          boardKind: entity.boardKind,
        },
      ];
    })
    .slice(0, limit);
}
