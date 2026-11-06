/** Board groups: add / rename / recolor / reorder / collapse / move to board / duplicate / delete. */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { groups, items } from '@/server/db/schema';
import { BadRequestError, NotFoundError } from '@/server/http/errors';
import { publish } from '@/server/realtime/publisher';
import { requireBoard } from './access';
import { logActivity } from './activity';
import { inTransaction, type ServiceContext } from './context';
import type { GroupDto } from './contracts/dto';
import type { CreateGroupInput, UpdateGroupInput } from './contracts/structure-inputs';
import { duplicateItemRow, moveItem } from './items';
import { toGroupDto } from './mappers';
import { positionBefore, positionBetween, resolveMovePosition } from './positions';
import { LABEL_COLORS, type LabelColor } from '@/server/db/schema/cell-values';

const GROUP_COLOR_CYCLE: readonly LabelColor[] = [
  'blue',
  'purple',
  'green',
  'orange',
  'pink',
  'teal',
  'red',
  'yellow',
  'indigo',
  'brown',
];

function publishGroups(ctx: ServiceContext, boardId: string, ids: string[]) {
  return publish(ctx.db, { type: 'groups.changed', orgId: ctx.orgId, boardId, ids, actorId: ctx.userId });
}

async function boardGroups(ctx: ServiceContext, boardId: string) {
  return ctx.db
    .select()
    .from(groups)
    .where(and(eq(groups.boardId, boardId), eq(groups.orgId, ctx.orgId), isNull(groups.deletedAt)))
    .orderBy(asc(groups.position), asc(groups.id));
}

export async function listGroups(
  ctx: ServiceContext,
  boardId: string,
  includeArchived = false,
): Promise<GroupDto[]> {
  await requireBoard(ctx, boardId, 'read');
  const rows = await boardGroups(ctx, boardId);
  return rows.filter((row) => includeArchived || row.archivedAt === null).map(toGroupDto);
}

async function requireGroupRow(ctx: ServiceContext, boardId: string, groupId: string) {
  const [row] = await ctx.db
    .select()
    .from(groups)
    .where(
      and(
        eq(groups.id, groupId),
        eq(groups.boardId, boardId),
        eq(groups.orgId, ctx.orgId),
        isNull(groups.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Group');
  return row;
}

export async function createGroup(
  ctx: ServiceContext,
  boardId: string,
  input: CreateGroupInput,
): Promise<GroupDto> {
  return inTransaction(ctx, async (tx) => {
    await requireBoard(tx, boardId, 'write');
    const siblings = await boardGroups(tx, boardId);
    // New groups go on top by default (matches the "Add new group" affordance), unless placed.
    const position =
      input.afterId || input.beforeId
        ? resolveMovePosition(siblings, input)
        : positionBefore(siblings[0]?.position);
    const used = new Set(siblings.map((group) => group.color));
    const color = input.color ?? GROUP_COLOR_CYCLE.find((candidate) => !used.has(candidate)) ?? 'blue';
    const [row] = await tx.db
      .insert(groups)
      .values({ orgId: tx.orgId, boardId, title: input.title, color, position })
      .returning();
    if (!row) throw new Error('Group insert returned no row');
    await logActivity(tx, { boardId, action: 'group.created', after: { groupId: row.id, title: row.title } });
    await publishGroups(tx, boardId, [row.id]);
    return toGroupDto(row);
  });
}

export async function updateGroup(
  ctx: ServiceContext,
  boardId: string,
  groupId: string,
  input: UpdateGroupInput,
): Promise<GroupDto> {
  return inTransaction(ctx, async (tx) => {
    await requireBoard(tx, boardId, 'write');
    const group = await requireGroupRow(tx, boardId, groupId);
    if (input.color && !(LABEL_COLORS as readonly string[]).includes(input.color))
      throw new BadRequestError('Unknown color');

    if (input.targetBoardId && input.targetBoardId !== boardId) {
      return moveGroupToBoard(tx, boardId, group, input.targetBoardId);
    }

    let position: string | undefined;
    if (input.afterId || input.beforeId) {
      const siblings = await boardGroups(tx, boardId);
      position = resolveMovePosition(
        siblings.filter((entry) => entry.id !== groupId),
        input,
      );
    }
    const [row] = await tx.db
      .update(groups)
      .set({
        ...(input.title !== undefined && { title: input.title }),
        ...(input.color !== undefined && { color: input.color }),
        ...(input.collapsedDefault !== undefined && { collapsedDefault: input.collapsedDefault }),
        ...(position && { position }),
        updatedAt: new Date(),
      })
      .where(eq(groups.id, groupId))
      .returning();
    if (!row) throw new NotFoundError('Group');
    if (input.title !== undefined && input.title !== group.title) {
      await logActivity(tx, {
        boardId,
        action: 'group.renamed',
        before: { title: group.title },
        after: { title: row.title, groupId },
      });
    }
    if (input.color !== undefined && input.color !== group.color) {
      await logActivity(tx, {
        boardId,
        action: 'group.recolored',
        before: { color: group.color },
        after: { color: row.color, groupId },
      });
    }
    await publishGroups(tx, boardId, [groupId]);
    return toGroupDto(row);
  });
}

/** Move a group with all its items to another board (values kept where key + type match). */
async function moveGroupToBoard(
  tx: ServiceContext,
  boardId: string,
  group: typeof groups.$inferSelect,
  targetBoardId: string,
): Promise<GroupDto> {
  await requireBoard(tx, targetBoardId, 'write');
  const targetGroups = await boardGroups(tx, targetBoardId);
  const [created] = await tx.db
    .insert(groups)
    .values({
      orgId: tx.orgId,
      boardId: targetBoardId,
      title: group.title,
      color: group.color,
      position: positionBefore(targetGroups[0]?.position),
    })
    .returning();
  if (!created) throw new Error('Group insert returned no row');
  const groupItems = await tx.db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.groupId, group.id), isNull(items.parentItemId), isNull(items.deletedAt)))
    .orderBy(asc(items.position));
  for (const entry of groupItems) {
    await moveItem(tx, entry.id, { boardId: targetBoardId, groupId: created.id });
  }
  await tx.db.update(groups).set({ deletedAt: new Date() }).where(eq(groups.id, group.id));
  await logActivity(tx, {
    boardId,
    action: 'group.moved_board',
    before: { groupId: group.id },
    after: { boardId: targetBoardId, groupId: created.id },
  });
  await publishGroups(tx, boardId, [group.id]);
  await publishGroups(tx, targetBoardId, [created.id]);
  return toGroupDto(created);
}

export async function duplicateGroup(
  ctx: ServiceContext,
  boardId: string,
  groupId: string,
): Promise<GroupDto> {
  return inTransaction(ctx, async (tx) => {
    await requireBoard(tx, boardId, 'write');
    const group = await requireGroupRow(tx, boardId, groupId);
    const siblings = await boardGroups(tx, boardId);
    const index = siblings.findIndex((entry) => entry.id === groupId);
    const position = positionBetween(group.position, siblings[index + 1]?.position);
    const [created] = await tx.db
      .insert(groups)
      .values({
        orgId: tx.orgId,
        boardId,
        title: `Duplicate of ${group.title}`.slice(0, 255),
        color: group.color,
        position,
      })
      .returning();
    if (!created) throw new Error('Group insert returned no row');
    const groupItems = await tx.db
      .select()
      .from(items)
      .where(
        and(
          eq(items.groupId, groupId),
          isNull(items.parentItemId),
          isNull(items.deletedAt),
          isNull(items.archivedAt),
        ),
      )
      .orderBy(asc(items.position));
    for (const item of groupItems) {
      await duplicateItemRow(
        tx,
        { ...item, groupId: created.id },
        { withSubitems: true, withUpdates: false, position: item.position, nameSuffix: '' },
      );
    }
    await logActivity(tx, {
      boardId,
      action: 'group.duplicated',
      before: { groupId },
      after: { groupId: created.id },
    });
    await publishGroups(tx, boardId, [created.id]);
    await publish(tx.db, { type: 'items.changed', orgId: tx.orgId, boardId, actorId: tx.userId });
    return toGroupDto(created);
  });
}

export async function setGroupArchived(
  ctx: ServiceContext,
  boardId: string,
  groupId: string,
  archived: boolean,
): Promise<GroupDto> {
  return inTransaction(ctx, async (tx) => {
    await requireBoard(tx, boardId, 'write');
    const [row] = await tx.db
      .update(groups)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(
        and(
          eq(groups.id, groupId),
          eq(groups.boardId, boardId),
          eq(groups.orgId, tx.orgId),
          isNull(groups.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundError('Group');
    await logActivity(tx, {
      boardId,
      action: archived ? 'group.archived' : 'group.restored',
      after: { groupId, title: row.title },
    });
    await publishGroups(tx, boardId, [groupId]);
    return toGroupDto(row);
  });
}

/** Soft-deletes the group and its items (restorable from the trash). */
export async function deleteGroup(
  ctx: ServiceContext,
  boardId: string,
  groupId: string,
): Promise<{ id: string }> {
  return inTransaction(ctx, async (tx) => {
    await requireBoard(tx, boardId, 'write');
    const group = await requireGroupRow(tx, boardId, groupId);
    const live = (await boardGroups(tx, boardId)).filter((entry) => entry.archivedAt === null);
    if (live.length <= 1 && group.archivedAt === null)
      throw new BadRequestError('A board must keep at least one group');
    const now = new Date();
    await tx.db.update(groups).set({ deletedAt: now }).where(eq(groups.id, groupId));
    await tx.db
      .update(items)
      .set({ deletedAt: now })
      .where(and(eq(items.groupId, groupId), isNull(items.deletedAt)));
    await logActivity(tx, { boardId, action: 'group.deleted', before: { groupId, title: group.title } });
    await publishGroups(tx, boardId, [groupId]);
    await publish(tx.db, { type: 'items.deleted', orgId: tx.orgId, boardId, actorId: tx.userId });
    return { id: groupId };
  });
}
