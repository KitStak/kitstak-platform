/**
 * Item domain events emitted by item mutations and consumed by the automations engine.
 * The engine is imported lazily to keep the services ↔ engine dependency one-directional
 * at module-evaluation time.
 */
import type { ColumnType } from '@/server/db/schema/cell-values';
import { logger } from '@/server/logger';
import type { ServiceContext } from './context';

export type ItemEvent =
  | { readonly type: 'item_created'; readonly boardId: string; readonly itemId: string }
  | {
      readonly type: 'column_changed';
      readonly boardId: string;
      readonly itemId: string;
      readonly columnKey: string;
      readonly columnType: ColumnType;
      readonly before: unknown;
      readonly after: unknown;
    }
  | {
      readonly type: 'item_moved';
      readonly boardId: string;
      readonly itemId: string;
      readonly fromGroupId: string;
      readonly toGroupId: string;
    }
  | {
      readonly type: 'date_arrived';
      readonly boardId: string;
      readonly itemId: string;
      readonly columnKey: string;
    };

/** Hard cap on nested automation-triggered mutations. */
export const MAX_AUTOMATION_DEPTH = 3;

export async function dispatchItemEvents(ctx: ServiceContext, events: readonly ItemEvent[]): Promise<void> {
  if (events.length === 0 || ctx.skipAutomations) return;
  // Board webhooks: outbox rows written in this transaction, delivered after commit (never throws).
  const outbox = await import('./automations-webhooks-outbox');
  await outbox.enqueueWebhookEvents(ctx, events);
  // KitStak Projects: linked tasks follow stage changes ("when the deal moves to Won…"). Never throws.
  const stageChanges = events.filter(
    (event): event is Extract<ItemEvent, { type: 'column_changed' }> => event.type === 'column_changed' && event.columnType === 'status',
  );
  if (stageChanges.length > 0) {
    const projects = await import('./projects-bridge');
    for (const change of stageChanges) await projects.notifyProjectsOfStageChange(ctx, change);
  }
  const depth = ctx.automation?.depth ?? 0;
  if (depth >= MAX_AUTOMATION_DEPTH) {
    logger.warn('automations.depth_limit', { orgId: ctx.orgId, depth, events: events.length });
    return;
  }
  const engine = await import('@/server/automations-engine/engine');
  await engine.handleItemEvents(ctx, events);
}
