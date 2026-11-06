/** Board views (table, kanban, calendar, timeline, chart, form...). */
import { and, asc, eq, isNull, ne, or, type SQL } from 'drizzle-orm';
import { views } from '@/server/db/schema';
import { BadRequestError, ForbiddenError, NotFoundError } from '@/server/http/errors';
import { publish } from '@/server/realtime/publisher';
import { requireBoard } from './access';
import { inTransaction, type ServiceContext } from './context';
import type { ViewDto } from './contracts/dto';
import type { CreateViewInput, UpdateViewInput } from './contracts/structure-inputs';
import { guardViewConfigWrite, stripServerFormKeys } from './board-views-form-model';
import { toViewDto } from './mappers';
import { resolveMovePosition } from './positions';

function visibleViews(ctx: ServiceContext, boardId: string): SQL {
  return and(
    eq(views.boardId, boardId),
    eq(views.orgId, ctx.orgId),
    isNull(views.deletedAt),
    ctx.userId ? (or(isNull(views.ownerId), eq(views.ownerId, ctx.userId)) as SQL) : isNull(views.ownerId),
  ) as SQL;
}

export async function listViewRows(ctx: ServiceContext, boardId: string) {
  return ctx.db
    .select()
    .from(views)
    .where(visibleViews(ctx, boardId))
    .orderBy(asc(views.position), asc(views.id));
}

export async function listViews(ctx: ServiceContext, boardId: string): Promise<ViewDto[]> {
  await requireBoard(ctx, boardId, 'read');
  return (await listViewRows(ctx, boardId)).map(toViewDto);
}

async function requireView(ctx: ServiceContext, viewId: string) {
  const [row] = await ctx.db
    .select()
    .from(views)
    .where(and(eq(views.id, viewId), eq(views.orgId, ctx.orgId), isNull(views.deletedAt)))
    .limit(1);
  if (!row || (row.ownerId && row.ownerId !== ctx.userId)) throw new NotFoundError('View');
  return row;
}

function publishViews(ctx: ServiceContext, boardId: string, ids: string[]) {
  return publish(ctx.db, { type: 'views.changed', orgId: ctx.orgId, boardId, ids, actorId: ctx.userId });
}

export async function createView(
  ctx: ServiceContext,
  boardId: string,
  input: CreateViewInput,
): Promise<ViewDto> {
  return inTransaction(ctx, async (tx) => {
    // Personal views only need read access; shared views change the board for everyone.
    await requireBoard(tx, boardId, input.personal ? 'read' : 'write');
    const siblings = await listViewRows(tx, boardId);
    const [row] = await tx.db
      .insert(views)
      .values({
        orgId: tx.orgId,
        boardId,
        type: input.type,
        name: input.name,
        // Public form token / publish state / counter are server-owned (see setFormPublished).
        config: stripServerFormKeys(input.config as Record<string, unknown>),
        position: resolveMovePosition(siblings, input),
        isDefault: false,
        ownerId: input.personal ? tx.userId : null,
        createdBy: tx.userId,
      })
      .returning();
    if (!row) throw new Error('View insert returned no row');
    await publishViews(tx, boardId, [row.id]);
    return toViewDto(row);
  });
}

export async function updateView(
  ctx: ServiceContext,
  viewId: string,
  input: UpdateViewInput,
): Promise<ViewDto> {
  return inTransaction(ctx, async (tx) => {
    const view = await requireView(tx, viewId);
    await requireBoard(tx, view.boardId, view.ownerId ? 'read' : 'write');
    let position: string | undefined;
    if (input.afterId || input.beforeId) {
      const siblings = await listViewRows(tx, view.boardId);
      position = resolveMovePosition(
        siblings.filter((entry) => entry.id !== viewId),
        input,
      );
    }
    if (input.isDefault) {
      if (view.ownerId) throw new BadRequestError('A personal view cannot be the board default');
      await tx.db
        .update(views)
        .set({ isDefault: false })
        .where(and(eq(views.boardId, view.boardId), ne(views.id, viewId), eq(views.isDefault, true)));
    }
    // config.form.{token,published,responseCount} are server-owned and form is deep-merged.
    const config = input.config
      ? guardViewConfigWrite(view.config as Record<string, unknown>, input.config as Record<string, unknown>, input.mergeConfig)
      : undefined;
    const [row] = await tx.db
      .update(views)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(config && { config }),
        ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
        ...(position && { position }),
        updatedAt: new Date(),
      })
      .where(eq(views.id, viewId))
      .returning();
    if (!row) throw new NotFoundError('View');
    await publishViews(tx, view.boardId, [viewId]);
    return toViewDto(row);
  });
}

export async function deleteView(ctx: ServiceContext, viewId: string): Promise<{ id: string }> {
  return inTransaction(ctx, async (tx) => {
    const view = await requireView(tx, viewId);
    await requireBoard(tx, view.boardId, view.ownerId ? 'read' : 'write');
    const shared = (await listViewRows(tx, view.boardId)).filter((entry) => entry.ownerId === null);
    if (!view.ownerId && shared.length <= 1) throw new ForbiddenError('A board must keep at least one view');
    await tx.db.update(views).set({ deletedAt: new Date(), isDefault: false }).where(eq(views.id, viewId));
    if (view.isDefault) {
      const next = shared.find((entry) => entry.id !== viewId);
      if (next) await tx.db.update(views).set({ isDefault: true }).where(eq(views.id, next.id));
    }
    await publishViews(tx, view.boardId, [viewId]);
    return { id: viewId };
  });
}
