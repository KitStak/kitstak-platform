/**
 * Realtime for dashboards: publishes `dashboard.changed` hints after widget / layout / metadata
 * mutations, and decides which org events a dashboard stream forwards (its own changes plus
 * item, column and group changes on its source boards).
 */
import { publish } from '@/server/realtime/publisher';
import type { RealtimeEvent } from '@/server/realtime/events';
import type { ServiceContext } from './context';

export function publishDashboardChanged(
  ctx: ServiceContext,
  dashboardId: string,
  widgetIds: readonly string[] = [],
): Promise<void> {
  return publish(ctx.db, {
    type: 'dashboard.changed',
    orgId: ctx.orgId,
    ids: [dashboardId, ...widgetIds],
    actorId: ctx.userId,
  });
}

const BOARD_DATA_EVENTS = new Set<RealtimeEvent['type']>([
  'items.changed',
  'items.deleted',
  'columns.changed',
  'groups.changed',
  'board.updated',
  'board.deleted',
]);

/** Delivery filter for one dashboard's stream. */
export function dashboardStreamFilter(
  orgId: string,
  dashboardId: string,
  boardIds: readonly string[],
): (event: RealtimeEvent) => boolean {
  const boards = new Set(boardIds);
  return (event) => {
    if (event.orgId !== orgId) return false;
    if (event.type === 'dashboard.changed') return event.ids[0] === dashboardId;
    return BOARD_DATA_EVENTS.has(event.type) && event.boardId !== null && boards.has(event.boardId);
  };
}
