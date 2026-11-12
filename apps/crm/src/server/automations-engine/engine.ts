/**
 * Automations engine. Runs synchronously inside the triggering request's transaction:
 *   item event → enabled automations of the board → trigger match → conditions → actions.
 *
 * Isolation: every run executes in a SAVEPOINT, so a failing action rolls back only that
 * run (recorded as `failed` in automation_runs) and never the user's own change.
 * Loop guard: actions carry `automation.depth + 1`; `dispatchItemEvents` stops at
 * MAX_AUTOMATION_DEPTH, and one dispatch executes at most MAX_RUNS_PER_DISPATCH runs.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { automationRuns, automations, boards, items } from '@/server/db/schema';
import { isAppError } from '@/server/http/errors';
import { logger } from '@/server/logger';
import type { ServiceContext } from '@/server/services/context';
import type { ItemEvent } from '@/server/services/item-events';
import { executeAction, type ActionOutcome } from './actions';
import { allConditionsHold, triggerMatches } from './matching';
import {
  actionSchema,
  conditionSchema,
  triggerSchema,
  type AutomationActionRecipe,
  type AutomationConditionRecipe,
  type AutomationTriggerRecipe,
} from './recipes';

export const MAX_RUNS_PER_DISPATCH = 25;

type AutomationRow = typeof automations.$inferSelect;

interface ParsedAutomation {
  readonly row: AutomationRow;
  readonly trigger: AutomationTriggerRecipe;
  readonly conditions: AutomationConditionRecipe[];
  readonly actions: AutomationActionRecipe[];
}

/** Parse stored recipe JSON; invalid recipes are skipped (and logged), never executed. */
export function parseAutomation(row: AutomationRow): ParsedAutomation | null {
  const trigger = triggerSchema.safeParse(row.trigger);
  const conditions = conditionSchema.array().safeParse(row.conditions);
  const actions = actionSchema.array().safeParse(row.actions);
  if (!trigger.success || !conditions.success || !actions.success) {
    logger.warn('automations.invalid_recipe', { automationId: row.id });
    return null;
  }
  return { row, trigger: trigger.data, conditions: conditions.data, actions: actions.data };
}

async function loadEnabled(ctx: ServiceContext, boardIds: readonly string[]): Promise<ParsedAutomation[]> {
  if (boardIds.length === 0) return [];
  const rows = await ctx.db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.orgId, ctx.orgId),
        inArray(automations.boardId, [...boardIds]),
        eq(automations.enabled, true),
        isNull(automations.deletedAt),
      ),
    )
    .orderBy(automations.createdAt);
  return rows.map(parseAutomation).filter((entry): entry is ParsedAutomation => entry !== null);
}

export interface RunResult {
  readonly automationId: string;
  readonly itemId: string;
  readonly status: 'succeeded' | 'failed';
  readonly error?: string;
}

/** Execute one automation for one item (conditions already checked by the caller or re-checked here). */
export async function runAutomation(
  ctx: ServiceContext,
  automation: ParsedAutomation,
  itemId: string,
  event: ItemEvent | Record<string, unknown>,
): Promise<RunResult | null> {
  const [item] = await ctx.db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.orgId, ctx.orgId), isNull(items.deletedAt)))
    .limit(1);
  if (!item || item.boardId !== automation.row.boardId) return null;
  if (!allConditionsHold(automation.conditions, { groupId: item.groupId, values: item.values })) return null;
  const [board] = await ctx.db.select().from(boards).where(eq(boards.id, item.boardId)).limit(1);
  if (!board) return null;

  const started = Date.now();
  const actionCtx: ServiceContext = {
    ...ctx,
    automation: { automationId: automation.row.id, depth: (ctx.automation?.depth ?? 0) + 1 },
  };
  const outcomes: ActionOutcome[] = [];
  let failure: string | null = null;
  try {
    await ctx.db.transaction(async (savepoint) => {
      const runCtx: ServiceContext = { ...actionCtx, db: savepoint };
      for (const action of automation.actions) {
        const [fresh] = await savepoint.select().from(items).where(eq(items.id, itemId)).limit(1);
        if (!fresh || fresh.deletedAt || fresh.archivedAt) break;
        outcomes.push(
          await executeAction(action, { ctx: runCtx, item: fresh, board, triggeredBy: ctx.userId }),
        );
      }
    });
  } catch (error) {
    failure = isAppError(error) ? error.message : 'Unexpected error while running the automation';
    if (!isAppError(error))
      logger.error('automations.run_failed', { automationId: automation.row.id, itemId, error });
  }
  const finished = Date.now();
  await ctx.db.insert(automationRuns).values({
    orgId: ctx.orgId,
    automationId: automation.row.id,
    boardId: automation.row.boardId,
    itemId,
    status: failure ? 'failed' : 'succeeded',
    triggerEvent: { ...(event as Record<string, unknown>) },
    result: { actions: outcomes },
    error: failure,
    startedAt: new Date(started),
    finishedAt: new Date(finished),
    durationMs: finished - started,
  });
  await ctx.db
    .update(automations)
    .set({
      runCount: sql`${automations.runCount} + 1`,
      ...(failure && { failureCount: sql`${automations.failureCount} + 1` }),
      lastRunAt: new Date(finished),
    })
    .where(eq(automations.id, automation.row.id));
  return failure
    ? { automationId: automation.row.id, itemId, status: 'failed', error: failure }
    : { automationId: automation.row.id, itemId, status: 'succeeded' };
}

/** Entry point used by `dispatchItemEvents`. */
export async function handleItemEvents(
  ctx: ServiceContext,
  events: readonly ItemEvent[],
): Promise<RunResult[]> {
  const boardIds = [...new Set(events.map((event) => event.boardId))];
  const enabled = await loadEnabled(ctx, boardIds);
  if (enabled.length === 0) return [];
  const results: RunResult[] = [];
  for (const event of events) {
    for (const automation of enabled) {
      if (automation.row.boardId !== event.boardId) continue;
      // An automation never re-triggers itself (direct loop guard).
      if (ctx.automation?.automationId === automation.row.id) continue;
      if (!triggerMatches(automation.trigger, event)) continue;
      if (results.length >= MAX_RUNS_PER_DISPATCH) {
        logger.warn('automations.run_cap_reached', { orgId: ctx.orgId, cap: MAX_RUNS_PER_DISPATCH });
        return results;
      }
      const result = await runAutomation(ctx, automation, event.itemId, event);
      if (result) results.push(result);
    }
  }
  return results;
}

export async function loadEnabledAutomations(
  ctx: ServiceContext,
  boardIds: readonly string[],
): Promise<ParsedAutomation[]> {
  return loadEnabled(ctx, boardIds);
}
export type { ParsedAutomation };
