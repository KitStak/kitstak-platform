/** Automation CRUD + run history. Execution lives in `src/server/automations-engine`. */
import { and, asc, desc, eq, isNull, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { automationRuns, automations, columns, groups } from '@/server/db/schema';
import {
  automationRecipeSchema,
  referencedColumnKeys,
  type CreateAutomationInput,
  type UpdateAutomationInput,
} from '@/server/automations-engine/recipes';
import { NotFoundError, ValidationError, type FieldIssue } from '@/server/http/errors';
import { publish } from '@/server/realtime/publisher';
import { requireBoard } from './access';
import { logActivity } from './activity';
import { inTransaction, type ServiceContext } from './context';
import type { AutomationDto, AutomationRunDto } from './contracts/dto';
import { decodeCursor, encodeCursor, timeIdCursorSchema, toPage, type Page } from './pagination';

type AutomationRow = typeof automations.$inferSelect;

function toAutomationDto(row: AutomationRow): AutomationDto {
  return {
    id: row.id,
    boardId: row.boardId,
    name: row.name,
    description: row.description,
    trigger: row.trigger,
    conditions: row.conditions,
    actions: row.actions,
    enabled: row.enabled,
    runCount: row.runCount,
    failureCount: row.failureCount,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Check that every column / group / board a recipe references exists and is reachable. */
async function validateRecipeTargets(
  ctx: ServiceContext,
  boardId: string,
  recipe: z.infer<typeof automationRecipeSchema>,
) {
  const issues: FieldIssue[] = [];
  const boardColumns = await ctx.db
    .select({ key: columns.key })
    .from(columns)
    .where(and(eq(columns.boardId, boardId), isNull(columns.deletedAt)));
  const keys = new Set(boardColumns.map((column) => column.key));
  for (const key of referencedColumnKeys(recipe)) {
    if (!keys.has(key))
      issues.push({ path: 'recipe', message: `Column "${key}" does not exist on this board` });
  }
  const groupIds = new Set<string>();
  if (recipe.trigger.type === 'item_moved_to_group') groupIds.add(recipe.trigger.config.groupId);
  for (const condition of recipe.conditions)
    if (condition.type === 'in_group') groupIds.add(condition.config.groupId);
  for (const action of recipe.actions)
    if (action.type === 'move_to_group') groupIds.add(action.config.groupId);
  if (groupIds.size > 0) {
    const rows = await ctx.db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.boardId, boardId), isNull(groups.deletedAt)));
    const existing = new Set(rows.map((row) => row.id));
    for (const id of groupIds)
      if (!existing.has(id))
        issues.push({ path: 'recipe', message: 'A referenced group does not exist on this board' });
  }
  for (const action of recipe.actions) {
    if (action.type !== 'create_item') continue;
    try {
      await requireBoard(ctx, action.config.boardId, 'write');
    } catch {
      issues.push({ path: 'actions', message: 'You cannot create items on the selected target board' });
    }
  }
  if (issues.length > 0) throw new ValidationError(issues);
}

export async function listAutomations(ctx: ServiceContext, boardId: string): Promise<AutomationDto[]> {
  await requireBoard(ctx, boardId, 'read');
  const rows = await ctx.db
    .select()
    .from(automations)
    .where(
      and(eq(automations.boardId, boardId), eq(automations.orgId, ctx.orgId), isNull(automations.deletedAt)),
    )
    .orderBy(asc(automations.createdAt));
  return rows.map(toAutomationDto);
}

async function requireAutomation(ctx: ServiceContext, automationId: string): Promise<AutomationRow> {
  const [row] = await ctx.db
    .select()
    .from(automations)
    .where(
      and(eq(automations.id, automationId), eq(automations.orgId, ctx.orgId), isNull(automations.deletedAt)),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Automation');
  return row;
}

export async function getAutomation(ctx: ServiceContext, automationId: string): Promise<AutomationDto> {
  const row = await requireAutomation(ctx, automationId);
  await requireBoard(ctx, row.boardId, 'read');
  return toAutomationDto(row);
}

export async function createAutomation(
  ctx: ServiceContext,
  boardId: string,
  input: CreateAutomationInput,
): Promise<AutomationDto> {
  return inTransaction(ctx, async (tx) => {
    await requireBoard(tx, boardId, 'write');
    await validateRecipeTargets(tx, boardId, input);
    const [row] = await tx.db
      .insert(automations)
      .values({
        orgId: tx.orgId,
        boardId,
        name: input.name,
        description: input.description ?? null,
        trigger: input.trigger,
        conditions: input.conditions,
        actions: input.actions,
        enabled: input.enabled,
        createdBy: tx.userId,
      })
      .returning();
    if (!row) throw new Error('Automation insert returned no row');
    await logActivity(tx, {
      boardId,
      action: 'automation.created',
      after: { automationId: row.id, name: row.name },
    });
    await publish(tx.db, {
      type: 'automations.changed',
      orgId: tx.orgId,
      boardId,
      ids: [row.id],
      actorId: tx.userId,
    });
    return toAutomationDto(row);
  });
}

export async function updateAutomation(
  ctx: ServiceContext,
  automationId: string,
  input: UpdateAutomationInput,
): Promise<AutomationDto> {
  return inTransaction(ctx, async (tx) => {
    const existing = await requireAutomation(tx, automationId);
    await requireBoard(tx, existing.boardId, 'write');
    const recipe = automationRecipeSchema.parse({
      trigger: input.trigger ?? existing.trigger,
      conditions: input.conditions ?? existing.conditions,
      actions: input.actions ?? existing.actions,
    });
    await validateRecipeTargets(tx, existing.boardId, recipe);
    const [row] = await tx.db
      .update(automations)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        trigger: recipe.trigger,
        conditions: recipe.conditions,
        actions: recipe.actions,
        updatedAt: new Date(),
      })
      .where(eq(automations.id, automationId))
      .returning();
    if (!row) throw new NotFoundError('Automation');
    if (input.enabled !== undefined && input.enabled !== existing.enabled) {
      await logActivity(tx, {
        boardId: row.boardId,
        action: input.enabled ? 'automation.enabled' : 'automation.disabled',
        after: { automationId },
      });
    }
    await publish(tx.db, {
      type: 'automations.changed',
      orgId: tx.orgId,
      boardId: row.boardId,
      ids: [row.id],
      actorId: tx.userId,
    });
    return toAutomationDto(row);
  });
}

export async function deleteAutomation(ctx: ServiceContext, automationId: string): Promise<{ id: string }> {
  return inTransaction(ctx, async (tx) => {
    const existing = await requireAutomation(tx, automationId);
    await requireBoard(tx, existing.boardId, 'write');
    await tx.db
      .update(automations)
      .set({ deletedAt: new Date(), enabled: false })
      .where(eq(automations.id, automationId));
    await logActivity(tx, {
      boardId: existing.boardId,
      action: 'automation.deleted',
      // `enabled` lets Undo (automation-center restore) bring it back exactly as it was.
      before: { automationId, name: existing.name, enabled: existing.enabled },
    });
    await publish(tx.db, {
      type: 'automations.changed',
      orgId: tx.orgId,
      boardId: existing.boardId,
      ids: [automationId],
      actorId: tx.userId,
    });
    return { id: automationId };
  });
}

export const listRunsQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listAutomationRuns(
  ctx: ServiceContext,
  automationId: string,
  query: z.infer<typeof listRunsQuerySchema>,
): Promise<Page<AutomationRunDto>> {
  const automation = await requireAutomation(ctx, automationId);
  await requireBoard(ctx, automation.boardId, 'read');
  const cursor = decodeCursor(query.cursor, timeIdCursorSchema);
  const conditions: SQL[] = [
    eq(automationRuns.automationId, automationId),
    eq(automationRuns.orgId, ctx.orgId),
  ];
  if (cursor) {
    const at = new Date(cursor[0]);
    conditions.push(
      or(
        lt(automationRuns.createdAt, at),
        and(eq(automationRuns.createdAt, at), lt(automationRuns.id, cursor[1])),
      ) as SQL,
    );
  }
  const rows = await ctx.db
    .select()
    .from(automationRuns)
    .where(and(...conditions))
    .orderBy(desc(automationRuns.createdAt), desc(automationRuns.id))
    .limit(query.limit + 1);
  const page = toPage(rows, query.limit, (row) => encodeCursor([row.createdAt.toISOString(), row.id]));
  return {
    nextCursor: page.nextCursor,
    items: page.items.map((row) => ({
      id: row.id,
      automationId: row.automationId,
      itemId: row.itemId,
      status: row.status,
      triggerEvent: row.triggerEvent,
      result: row.result ?? null,
      error: row.error,
      durationMs: row.durationMs,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
