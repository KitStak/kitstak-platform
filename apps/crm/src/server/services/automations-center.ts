/**
 * Automations center reads + manual runs: board run history (with automation / item names),
 * org-wide usage (runs this month per automation), dry-run previews and manual / retry runs.
 * CRUD of automations stays in `./automations`; execution in `src/server/automations-engine`.
 */
import { and, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { activityLog, automationRuns, automations, boards, items } from '@/server/db/schema';
import { parseAutomation, runAutomation } from '@/server/automations-engine/engine';
import { conditionHolds } from '@/server/automations-engine/matching';
import { NotFoundError, ValidationError } from '@/server/http/errors';
import { publish } from '@/server/realtime/publisher';
import { logActivity } from './activity';
import { requireBoard, requireItem, visibleBoardsPredicate } from './access';
import { inTransaction, type ServiceContext } from './context';
import {
  AUTOMATION_MONTHLY_ALLOWANCE,
  type AutomationManualRunDto,
  type AutomationPreviewDto,
  type AutomationUsageDto,
  type BoardRunDto,
  type BoardRunsQuery,
  type RestoreAutomationInput,
  type RunAutomationInput,
} from './contracts/automations-center';
import type { AutomationDto } from './contracts/dto';
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

/** Start of the current UTC month plus calendar facts used by the usage meter. */
export function monthWindow(now: Date = new Date()): {
  start: Date;
  daysInMonth: number;
  dayOfMonth: number;
} {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return { start, daysInMonth, dayOfMonth: now.getUTCDate() };
}

// Board run history ----------------------------------------------------------------------------

export async function listBoardRuns(
  ctx: ServiceContext,
  boardId: string,
  query: BoardRunsQuery,
): Promise<Page<BoardRunDto>> {
  await requireBoard(ctx, boardId, 'read');
  const cursor = decodeCursor(query.cursor, timeIdCursorSchema);
  const conditions: SQL[] = [
    eq(automationRuns.orgId, ctx.orgId),
    eq(automations.boardId, boardId),
    eq(automations.orgId, ctx.orgId),
  ];
  if (query.status === 'pending') conditions.push(inArray(automationRuns.status, ['pending', 'running']));
  else if (query.status) conditions.push(eq(automationRuns.status, query.status));
  if (query.automationId) conditions.push(eq(automationRuns.automationId, query.automationId));
  if (query.since) conditions.push(gte(automationRuns.createdAt, new Date(query.since)));
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
    .select({ run: automationRuns, automationName: automations.name, itemName: items.name })
    .from(automationRuns)
    .innerJoin(automations, eq(automations.id, automationRuns.automationId))
    .leftJoin(items, and(eq(items.id, automationRuns.itemId), eq(items.orgId, ctx.orgId)))
    .where(and(...conditions))
    .orderBy(desc(automationRuns.createdAt), desc(automationRuns.id))
    .limit(query.limit + 1);
  const page = toPage(rows, query.limit, (row) =>
    encodeCursor([row.run.createdAt.toISOString(), row.run.id]),
  );
  return {
    nextCursor: page.nextCursor,
    items: page.items.map(({ run, automationName, itemName }) => ({
      id: run.id,
      automationId: run.automationId,
      automationName,
      itemId: run.itemId,
      itemName: itemName ?? null,
      status: run.status,
      triggerEvent: run.triggerEvent,
      result: run.result ?? null,
      error: run.error,
      durationMs: run.durationMs,
      createdAt: run.createdAt.toISOString(),
    })),
  };
}

// Org usage ------------------------------------------------------------------------------------

export async function getAutomationUsage(
  ctx: ServiceContext,
  now: Date = new Date(),
): Promise<AutomationUsageDto> {
  const window = monthWindow(now);
  const rows = await ctx.db
    .select({ automation: automations, boardName: boards.name, workspaceId: boards.workspaceId })
    .from(automations)
    .innerJoin(boards, eq(boards.id, automations.boardId))
    .where(and(eq(automations.orgId, ctx.orgId), isNull(automations.deletedAt), visibleBoardsPredicate(ctx)))
    .orderBy(boards.name, automations.createdAt);
  const ids = rows.map((row) => row.automation.id);

  const perAutomation = new Map<string, { runs: number; failures: number }>();
  const daily = Array.from({ length: window.daysInMonth }, () => 0);
  if (ids.length > 0) {
    const scope = and(
      eq(automationRuns.orgId, ctx.orgId),
      inArray(automationRuns.automationId, ids),
      gte(automationRuns.createdAt, window.start),
    );
    const counts = await ctx.db
      .select({
        automationId: automationRuns.automationId,
        runs: sql<number>`count(*)::int`,
        failures: sql<number>`(count(*) filter (where ${automationRuns.status} = 'failed'))::int`,
      })
      .from(automationRuns)
      .where(scope)
      .groupBy(automationRuns.automationId);
    for (const row of counts) perAutomation.set(row.automationId, { runs: row.runs, failures: row.failures });
    const days = await ctx.db
      .select({
        day: sql<number>`extract(day from (${automationRuns.createdAt} at time zone 'UTC'))::int`,
        runs: sql<number>`count(*)::int`,
      })
      .from(automationRuns)
      .where(scope)
      .groupBy(sql`1`);
    for (const row of days) if (row.day >= 1 && row.day <= daily.length) daily[row.day - 1] = row.runs;
  }

  const list = rows.map(({ automation, boardName, workspaceId }) => {
    const usage = perAutomation.get(automation.id) ?? { runs: 0, failures: 0 };
    return {
      ...toAutomationDto(automation),
      boardName,
      workspaceId,
      runsThisMonth: usage.runs,
      failuresThisMonth: usage.failures,
    };
  });
  return {
    monthStart: window.start.toISOString(),
    daysInMonth: window.daysInMonth,
    dayOfMonth: window.dayOfMonth,
    allowance: AUTOMATION_MONTHLY_ALLOWANCE,
    runsThisMonth: list.reduce((sum, row) => sum + row.runsThisMonth, 0),
    failuresThisMonth: list.reduce((sum, row) => sum + row.failuresThisMonth, 0),
    daily,
    automations: list,
  };
}

// Manual runs ----------------------------------------------------------------------------------

async function requireAutomationRow(ctx: ServiceContext, automationId: string): Promise<AutomationRow> {
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

/**
 * Run an automation on one item now (`dryRun: false`) or preview what would happen
 * (`dryRun: true`: conditions are evaluated, nothing is written). The trigger is not
 * re-checked: running manually means "pretend the trigger just fired for this item".
 */
export async function runAutomationOnItem(
  ctx: ServiceContext,
  automationId: string,
  input: RunAutomationInput,
): Promise<AutomationPreviewDto | AutomationManualRunDto> {
  const row = await requireAutomationRow(ctx, automationId);
  await requireBoard(ctx, row.boardId, input.dryRun ? 'read' : 'write');
  const { item } = await requireItem(ctx, input.itemId, 'read');
  if (item.boardId !== row.boardId) {
    throw new ValidationError([{ path: 'itemId', message: 'The item is not on this automation’s board' }]);
  }
  const parsed = parseAutomation(row);
  if (!parsed) {
    throw new ValidationError([
      {
        path: 'automation',
        message: 'This automation references something that no longer exists. Edit it first.',
      },
    ]);
  }
  const subject = { groupId: item.groupId, values: item.values as Record<string, unknown> };
  if (input.dryRun) {
    const conditions = parsed.conditions.map((condition, index) => ({
      index,
      type: condition.type,
      holds: conditionHolds(condition, subject),
    }));
    return {
      dryRun: true,
      itemId: item.id,
      itemName: item.name,
      conditionsMet: conditions.every((condition) => condition.holds),
      conditions,
      actions: parsed.actions.map((action, index) => ({ index, type: action.type })),
    };
  }
  const result = await inTransaction(ctx, (tx) =>
    runAutomation(tx, parsed, item.id, { type: 'manual_run', itemId: item.id, triggeredBy: ctx.userId }),
  );
  if (!result) {
    return {
      dryRun: false,
      itemId: item.id,
      status: 'skipped',
      error: 'The conditions are not met for this item',
    };
  }
  return { dryRun: false, itemId: item.id, status: result.status, error: result.error ?? null };
}

/** Re-run a past run's automation on the same item. */
export async function retryRun(ctx: ServiceContext, runId: string): Promise<AutomationManualRunDto> {
  const [run] = await ctx.db
    .select()
    .from(automationRuns)
    .where(and(eq(automationRuns.id, runId), eq(automationRuns.orgId, ctx.orgId)))
    .limit(1);
  if (!run) throw new NotFoundError('Run');
  if (!run.itemId) {
    throw new ValidationError([
      { path: 'runId', message: 'The item of this run was deleted, so it cannot be retried' },
    ]);
  }
  const result = await runAutomationOnItem(ctx, run.automationId, { itemId: run.itemId, dryRun: false });
  return result as AutomationManualRunDto;
}

// Restore (Undo delete) ---------------------------------------------------------------------------

/** Undo window after a delete; older deletes are permanent from the user's point of view. */
export const RESTORE_WINDOW_MS = 10 * 60_000;

/**
 * Undo a delete. Deletes are soft (`deletedAt`, which also stops the engine) and committed on
 * the server immediately; Undo restores the row with its previous enabled state.
 */
export async function restoreAutomation(
  ctx: ServiceContext,
  automationId: string,
  _input: RestoreAutomationInput = {},
  now: Date = new Date(),
): Promise<AutomationDto> {
  return inTransaction(ctx, async (tx) => {
    const [existing] = await tx.db
      .select()
      .from(automations)
      .where(and(eq(automations.id, automationId), eq(automations.orgId, tx.orgId)))
      .limit(1);
    if (!existing) throw new NotFoundError('Automation');
    await requireBoard(tx, existing.boardId, 'write');
    if (!existing.deletedAt) return toAutomationDto(existing);
    if (now.getTime() - existing.deletedAt.getTime() > RESTORE_WINDOW_MS) {
      throw new ValidationError([{ path: 'automationId', message: 'This automation can no longer be restored' }]);
    }
    // The pre-delete state comes from the server's own delete log, never from the client, so
    // Undo cannot be used to switch on an automation that was off when it was deleted.
    const [deletion] = await tx.db
      .select({ before: activityLog.before })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.orgId, tx.orgId),
          eq(activityLog.boardId, existing.boardId),
          eq(activityLog.action, 'automation.deleted'),
          sql`${activityLog.before}->>'automationId' = ${automationId}`,
        ),
      )
      .orderBy(desc(activityLog.createdAt))
      .limit(1);
    const enabled = (deletion?.before as { enabled?: unknown } | null | undefined)?.enabled === true;
    const [row] = await tx.db
      .update(automations)
      .set({ deletedAt: null, enabled, updatedAt: now })
      .where(and(eq(automations.id, automationId), eq(automations.orgId, tx.orgId)))
      .returning();
    if (!row) throw new NotFoundError('Automation');
    await logActivity(tx, {
      boardId: row.boardId,
      action: 'automation.restored',
      after: { automationId, name: row.name, enabled: row.enabled },
    });
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
