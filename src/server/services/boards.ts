/** Boards: list / get / create (templates) / update / duplicate / archive / delete / restore / share. */
import { and, asc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm';
import {
  boardMembers,
  boards,
  columns,
  folders,
  groups,
  itemLinks,
  items,
  member,
  updates,
  user,
  views,
} from '@/server/db/schema';
import { BadRequestError, ForbiddenError, NotFoundError } from '@/server/http/errors';
import { publish } from '@/server/realtime/publisher';
import {
  requireBoard,
  requireBoardOwner,
  requireWorkspace,
  visibleBoardsPredicate,
  type BoardRow,
} from './access';
import { logActivity } from './activity';
import { assertCreationAllowed } from './admin-org';
import { inTransaction, type ServiceContext, concurrently } from './context';
import type {
  BoardDto,
  BoardPayloadDto,
  BoardSummaryDto,
  BoardTemplateDto,
  UserSummaryDto,
} from './contracts/dto';
import type {
  BoardMembersInput,
  CreateBoardInput,
  DuplicateBoardInput,
  ListBoardsQuery,
  UpdateBoardInput,
} from './contracts/structure-inputs';
import { countBoardItems, listBoardItems, loadBoardColumns } from './item-reads';
import { toBoardSummaryDto, toColumnDto, toGroupDto, toViewDto } from './mappers';
import { positionAfter, positionBetween, resolveMovePosition } from './positions';
import { BLANK_TEMPLATE, BOARD_TEMPLATES, findTemplate } from './templates/crm';
import { instantiateTemplate, wireTemplateConnections } from './templates/instantiate';
import { listViewRows } from './views';

export function listBoardTemplates(): BoardTemplateDto[] {
  return BOARD_TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    kind: template.kind,
    icon: template.icon,
    category: template.category,
    columnCount: template.columns.filter((column) => column.scope !== 'subitem').length,
  }));
}

export async function listBoards(ctx: ServiceContext, query: ListBoardsQuery): Promise<BoardSummaryDto[]> {
  const conditions: SQL[] = [];
  if (query.workspaceId) conditions.push(eq(boards.workspaceId, query.workspaceId));
  if (query.kind) conditions.push(eq(boards.kind, query.kind));
  if (query.state === 'deleted') {
    // Trash: deleted boards the caller owns (or all, for admins).
    const rows = await ctx.db
      .select()
      .from(boards)
      .where(and(eq(boards.orgId, ctx.orgId), isNotNull(boards.deletedAt), ...conditions))
      .orderBy(asc(boards.name));
    const owned = [];
    for (const row of rows) {
      try {
        await requireBoardOwner(ctx, row.id);
        owned.push(row);
      } catch {
        // not restorable by the caller
      }
    }
    return owned.map(toBoardSummaryDto);
  }
  conditions.push(query.state === 'archived' ? isNotNull(boards.archivedAt) : isNull(boards.archivedAt));
  const rows = await ctx.db
    .select()
    .from(boards)
    .where(and(visibleBoardsPredicate(ctx), ...conditions))
    .orderBy(asc(boards.workspaceId), asc(boards.position));
  return rows.map(toBoardSummaryDto);
}

async function canEditBoard(ctx: ServiceContext, boardId: string): Promise<boolean> {
  try {
    await requireBoard(ctx, boardId, 'write');
    return true;
  } catch (error) {
    if (error instanceof ForbiddenError) return false;
    throw error;
  }
}

async function toBoardDto(ctx: ServiceContext, board: BoardRow): Promise<BoardDto> {
  const members = await ctx.db
    .select({ userId: boardMembers.userId, role: boardMembers.role })
    .from(boardMembers)
    .where(eq(boardMembers.boardId, board.id));
  return {
    ...toBoardSummaryDto(board),
    settings: board.settings as Record<string, unknown>,
    createdBy: board.createdBy,
    createdAt: board.createdAt.toISOString(),
    members,
    canEdit: await canEditBoard(ctx, board.id),
  };
}

export async function getBoard(ctx: ServiceContext, boardId: string): Promise<BoardDto> {
  return toBoardDto(ctx, await requireBoard(ctx, boardId, 'read'));
}

export async function listOrgUsers(ctx: ServiceContext): Promise<UserSummaryDto[]> {
  return ctx.db
    .select({ id: user.id, name: user.name, email: user.email, image: user.image, title: user.title })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.orgId))
    .orderBy(asc(user.name));
}

/** Everything a board page needs for first paint in one round trip. */
export async function getBoardPayload(
  ctx: ServiceContext,
  boardId: string,
  query: { limit: number; cursor?: string },
): Promise<BoardPayloadDto> {
  const board = await requireBoard(ctx, boardId, 'read');
  const boardColumns = await loadBoardColumns(ctx, boardId);
  const [dto, groupRows, viewRows, page, totalItems, users] = await concurrently(ctx, [
    () => toBoardDto(ctx, board),
    () =>
      ctx.db
        .select()
        .from(groups)
        .where(and(eq(groups.boardId, boardId), isNull(groups.deletedAt), isNull(groups.archivedAt)))
        .orderBy(asc(groups.position)),
    () => listViewRows(ctx, boardId),
    () =>
      listBoardItems(
        ctx,
        boardId,
        { limit: query.limit, cursor: query.cursor, state: 'active' },
        boardColumns,
      ),
    () => countBoardItems(ctx, boardId),
    () => listOrgUsers(ctx),
  ]);
  return {
    board: dto,
    columns: boardColumns.map(toColumnDto),
    groups: groupRows.map(toGroupDto),
    views: viewRows.map(toViewDto),
    items: page.items,
    nextCursor: page.nextCursor,
    totalItems,
    users,
  };
}

export async function createBoard(ctx: ServiceContext, input: CreateBoardInput): Promise<BoardDto> {
  return inTransaction(ctx, async (tx) => {
    await assertCreationAllowed(tx, 'board');
    await requireWorkspace(tx, input.workspaceId);
    const template = input.templateId ? findTemplate(input.templateId) : BLANK_TEMPLATE;
    if (!template) throw new BadRequestError('Unknown board template');
    const created = await instantiateTemplate(tx, template, {
      workspaceId: input.workspaceId,
      folderId: input.folderId ?? null,
      name: input.name,
      description: input.description ?? undefined,
      icon: input.icon ?? undefined,
      privacy: input.privacy,
      itemTerminology: input.itemTerminology,
      withSampleData: input.withSampleData || template.id === 'blank',
    });
    if (input.kind && input.kind !== created.board.kind) {
      await tx.db.update(boards).set({ kind: input.kind }).where(eq(boards.id, created.board.id));
    }
    await wireTemplateConnections(tx, [created], new Map());
    await logActivity(tx, {
      boardId: created.board.id,
      action: 'board.created',
      after: { name: created.board.name, templateId: template.id },
    });
    await publish(tx.db, {
      type: 'workspace.changed',
      orgId: tx.orgId,
      ids: [input.workspaceId],
      actorId: tx.userId,
    });
    return getBoard(tx, created.board.id);
  });
}

export async function updateBoard(
  ctx: ServiceContext,
  boardId: string,
  input: UpdateBoardInput,
): Promise<BoardDto> {
  return inTransaction(ctx, async (tx) => {
    const board = await requireBoard(tx, boardId, 'write');
    if (input.privacy && input.privacy !== board.privacy) await requireBoardOwner(tx, boardId);
    const workspaceId = input.workspaceId ?? board.workspaceId;
    if (input.workspaceId && input.workspaceId !== board.workspaceId)
      await requireWorkspace(tx, input.workspaceId);
    if (input.folderId) {
      const [folder] = await tx.db
        .select({ workspaceId: folders.workspaceId })
        .from(folders)
        .where(and(eq(folders.id, input.folderId), eq(folders.orgId, tx.orgId), isNull(folders.deletedAt)))
        .limit(1);
      if (!folder || folder.workspaceId !== workspaceId)
        throw new BadRequestError('Folder is not in the target workspace');
    }
    let position: string | undefined;
    if (input.afterId || input.beforeId || input.workspaceId) {
      const siblings = await tx.db
        .select({ id: boards.id, position: boards.position })
        .from(boards)
        .where(
          and(eq(boards.workspaceId, workspaceId), eq(boards.orgId, tx.orgId), isNull(boards.deletedAt)),
        );
      position = resolveMovePosition(
        siblings.filter((entry) => entry.id !== boardId),
        input,
      );
    }
    const [row] = await tx.db
      .update(boards)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.icon !== undefined && { icon: input.icon }),
        ...(input.privacy !== undefined && { privacy: input.privacy }),
        ...(input.itemTerminology !== undefined && { itemTerminology: input.itemTerminology }),
        ...(input.folderId !== undefined && { folderId: input.folderId }),
        ...(input.workspaceId !== undefined && {
          workspaceId: input.workspaceId,
          ...(input.folderId === undefined && { folderId: null }),
        }),
        ...(input.settings !== undefined && {
          settings: { ...(board.settings as Record<string, unknown>), ...input.settings },
        }),
        ...(position && { position }),
        updatedAt: new Date(),
      })
      .where(eq(boards.id, boardId))
      .returning();
    if (!row) throw new NotFoundError('Board');
    if (input.name !== undefined && input.name !== board.name) {
      await logActivity(tx, {
        boardId,
        action: 'board.renamed',
        before: { name: board.name },
        after: { name: row.name },
      });
    }
    await publish(tx.db, {
      type: 'board.updated',
      orgId: tx.orgId,
      boardId,
      ids: [boardId],
      actorId: tx.userId,
    });
    await publish(tx.db, {
      type: 'workspace.changed',
      orgId: tx.orgId,
      ids: [row.workspaceId],
      actorId: tx.userId,
    });
    return toBoardDto(tx, row);
  });
}

export type BoardLifecycle = 'archive' | 'unarchive' | 'delete' | 'restore';

export async function changeBoardLifecycle(
  ctx: ServiceContext,
  boardId: string,
  action: BoardLifecycle,
): Promise<BoardSummaryDto> {
  return inTransaction(ctx, async (tx) => {
    const board = await requireBoardOwner(tx, boardId);
    if (board.deletedAt && action !== 'restore') throw new NotFoundError('Board');
    const now = new Date();
    const set =
      action === 'archive'
        ? { archivedAt: now }
        : action === 'unarchive'
          ? { archivedAt: null }
          : action === 'delete'
            ? { deletedAt: now }
            : { deletedAt: null, archivedAt: null };
    const [row] = await tx.db
      .update(boards)
      .set({ ...set, updatedAt: now })
      .where(eq(boards.id, boardId))
      .returning();
    if (!row) throw new NotFoundError('Board');
    const actionNames: Record<BoardLifecycle, string> = {
      archive: 'board.archived',
      unarchive: 'board.unarchived',
      delete: 'board.deleted',
      restore: 'board.restored',
    };
    await logActivity(tx, { boardId, action: actionNames[action], before: { name: board.name } });
    await publish(tx.db, {
      type: action === 'delete' || action === 'archive' ? 'board.deleted' : 'board.updated',
      orgId: tx.orgId,
      boardId,
      ids: [boardId],
      actorId: tx.userId,
    });
    await publish(tx.db, {
      type: 'workspace.changed',
      orgId: tx.orgId,
      ids: [row.workspaceId],
      actorId: tx.userId,
    });
    return toBoardSummaryDto(row);
  });
}

export async function setBoardMembers(
  ctx: ServiceContext,
  boardId: string,
  input: BoardMembersInput,
): Promise<BoardDto> {
  return inTransaction(ctx, async (tx) => {
    const board = await requireBoardOwner(tx, boardId);
    const userIds = [...new Set(input.members.map((entry) => entry.userId))];
    if (userIds.length > 0) {
      const found = await tx.db
        .select({ userId: member.userId })
        .from(member)
        .where(and(eq(member.organizationId, tx.orgId), inArray(member.userId, userIds)));
      if (found.length !== userIds.length)
        throw new BadRequestError('Every board member must belong to the organization');
    }
    if (!input.members.some((entry) => entry.role === 'owner'))
      throw new BadRequestError('A board needs at least one owner');
    const before = await tx.db
      .select({ userId: boardMembers.userId })
      .from(boardMembers)
      .where(eq(boardMembers.boardId, boardId));
    await tx.db.delete(boardMembers).where(eq(boardMembers.boardId, boardId));
    await tx.db
      .insert(boardMembers)
      .values(
        input.members.map((entry) => ({ orgId: tx.orgId, boardId, userId: entry.userId, role: entry.role })),
      );
    const previous = new Set(before.map((row) => row.userId));
    const added = userIds.filter((id) => !previous.has(id));
    if (added.length > 0) {
      const { notify } = await import('./notifications');
      await notify(tx, {
        kind: 'board_shared',
        recipients: added,
        boardId,
        payload: { boardName: board.name },
      });
    }
    await logActivity(tx, { boardId, action: 'board.members_changed', after: { members: input.members } });
    await publish(tx.db, {
      type: 'board.updated',
      orgId: tx.orgId,
      boardId,
      ids: [boardId],
      actorId: tx.userId,
    });
    return getBoard(tx, boardId);
  });
}

export async function duplicateBoard(
  ctx: ServiceContext,
  boardId: string,
  input: DuplicateBoardInput,
): Promise<BoardDto> {
  return inTransaction(ctx, async (tx) => {
    const source = await requireBoard(tx, boardId, 'read');
    const workspaceId = input.workspaceId ?? source.workspaceId;
    await requireWorkspace(tx, workspaceId);
    const siblings = await tx.db
      .select({ id: boards.id, position: boards.position })
      .from(boards)
      .where(and(eq(boards.workspaceId, workspaceId), eq(boards.orgId, tx.orgId)))
      .orderBy(asc(boards.position));
    const index = siblings.findIndex((entry) => entry.id === boardId);
    const position =
      index >= 0
        ? positionBetween(source.position, siblings[index + 1]?.position)
        : positionAfter(siblings.at(-1)?.position);
    const [board] = await tx.db
      .insert(boards)
      .values({
        orgId: tx.orgId,
        workspaceId,
        folderId:
          input.folderId === undefined
            ? workspaceId === source.workspaceId
              ? source.folderId
              : null
            : input.folderId,
        name: input.name ?? `Duplicate of ${source.name}`.slice(0, 255),
        kind: source.kind,
        description: source.description,
        icon: source.icon,
        privacy: source.privacy,
        itemTerminology: source.itemTerminology,
        settings: source.settings,
        position,
        createdBy: tx.userId,
      })
      .returning();
    if (!board) throw new Error('Board insert returned no row');
    if (tx.userId)
      await tx.db
        .insert(boardMembers)
        .values({ orgId: tx.orgId, boardId: board.id, userId: tx.userId, role: 'owner' });

    const sourceColumns = await tx.db
      .select()
      .from(columns)
      .where(and(eq(columns.boardId, boardId), isNull(columns.deletedAt)));
    if (sourceColumns.length > 0) {
      await tx.db.insert(columns).values(
        sourceColumns.map((column) => ({
          orgId: tx.orgId,
          boardId: board.id,
          key: column.key,
          title: column.title,
          description: column.description,
          type: column.type,
          scope: column.scope,
          settings: column.settings,
          width: column.width,
          position: column.position,
          hidden: column.hidden,
          required: column.required,
          createdBy: tx.userId,
        })),
      );
    }
    const sourceGroups = await tx.db
      .select()
      .from(groups)
      .where(and(eq(groups.boardId, boardId), isNull(groups.deletedAt)))
      .orderBy(asc(groups.position));
    const groupMap = new Map<string, string>();
    for (const group of sourceGroups) {
      const [created] = await tx.db
        .insert(groups)
        .values({
          orgId: tx.orgId,
          boardId: board.id,
          title: group.title,
          color: group.color,
          position: group.position,
          collapsedDefault: group.collapsedDefault,
          archivedAt: group.archivedAt,
        })
        .returning({ id: groups.id });
      if (created) groupMap.set(group.id, created.id);
    }
    const sourceViews = await tx.db
      .select()
      .from(views)
      .where(and(eq(views.boardId, boardId), isNull(views.deletedAt), isNull(views.ownerId)));
    if (sourceViews.length > 0) {
      await tx.db.insert(views).values(
        sourceViews.map((view) => ({
          orgId: tx.orgId,
          boardId: board.id,
          type: view.type,
          name: view.name,
          config: view.config,
          position: view.position,
          isDefault: view.isDefault,
          createdBy: tx.userId,
        })),
      );
    }

    if (input.mode !== 'structure') {
      const sourceItems = await tx.db
        .select()
        .from(items)
        .where(and(eq(items.boardId, boardId), isNull(items.deletedAt), isNull(items.archivedAt)))
        .orderBy(asc(items.parentItemId), asc(items.position));
      const itemMap = new Map<string, string>();
      const ordered = [
        ...sourceItems.filter((row) => !row.parentItemId),
        ...sourceItems.filter((row) => row.parentItemId),
      ];
      for (let start = 0; start < ordered.length; start += 250) {
        const chunk = ordered.slice(start, start + 250).filter((row) => groupMap.has(row.groupId));
        if (chunk.length === 0) continue;
        const inserted = await tx.db
          .insert(items)
          .values(
            chunk.map((row) => ({
              orgId: tx.orgId,
              boardId: board.id,
              groupId: groupMap.get(row.groupId) as string,
              parentItemId: row.parentItemId ? (itemMap.get(row.parentItemId) ?? null) : null,
              name: row.name,
              position: row.position,
              values: row.values,
              createdBy: tx.userId,
              updatedBy: tx.userId,
            })),
          )
          .returning({ id: items.id });
        chunk.forEach((row, index) => {
          const created = inserted[index];
          if (created) itemMap.set(row.id, created.id);
        });
      }
      const sourceIds = [...itemMap.keys()];
      if (sourceIds.length > 0) {
        const links = await tx.db.select().from(itemLinks).where(inArray(itemLinks.fromItemId, sourceIds));
        if (links.length > 0) {
          await tx.db
            .insert(itemLinks)
            .values(
              links.map((link) => ({
                orgId: tx.orgId,
                fromItemId: itemMap.get(link.fromItemId) as string,
                toItemId: link.toItemId,
                columnKey: link.columnKey,
                position: link.position,
                createdBy: tx.userId,
              })),
            )
            .onConflictDoNothing();
        }
        if (input.mode === 'items_updates') {
          const threads = await tx.db
            .select()
            .from(updates)
            .where(
              and(
                inArray(updates.itemId, sourceIds),
                isNull(updates.deletedAt),
                isNull(updates.parentUpdateId),
              ),
            );
          if (threads.length > 0) {
            await tx.db.insert(updates).values(
              threads.map((update) => ({
                orgId: tx.orgId,
                boardId: board.id,
                itemId: itemMap.get(update.itemId) as string,
                authorId: update.authorId,
                body: update.body,
                bodyText: update.bodyText,
                mentionedUserIds: update.mentionedUserIds,
                pinned: update.pinned,
              })),
            );
          }
        }
      }
    }
    await logActivity(tx, {
      boardId: board.id,
      action: 'board.duplicated',
      before: { sourceBoardId: boardId },
      after: { name: board.name, mode: input.mode },
    });
    await publish(tx.db, {
      type: 'workspace.changed',
      orgId: tx.orgId,
      ids: [workspaceId],
      actorId: tx.userId,
    });
    return getBoard(tx, board.id);
  });
}
