/** Pure decision: what a realtime event means for an open dashboard. */
import type { RealtimeEvent } from '@/server/realtime/events';

export interface RealtimePlan {
  /** Refetch the dashboard (widgets, layout, metadata). */
  readonly dashboard: boolean;
  /** Refetch widget data. */
  readonly data: boolean;
  /** Widgets to mark "Updated by …" (changes made by someone else). */
  readonly pulseWidgetIds: readonly string[];
}

const NONE: RealtimePlan = { dashboard: false, data: false, pulseWidgetIds: [] };
const BOARD_DATA_EVENTS = new Set<string>(['items.changed', 'items.deleted', 'columns.changed', 'groups.changed', 'board.updated', 'board.deleted']);

export function planRealtimeRefresh(
  event: RealtimeEvent,
  context: { readonly dashboardId: string; readonly userId: string; readonly boardIds: readonly string[] },
): RealtimePlan {
  if (event.type === 'dashboard.changed') {
    if (event.ids[0] !== context.dashboardId) return NONE;
    const remote = event.actorId !== context.userId;
    return {
      dashboard: true,
      // A widget config change alters its data; layout-only changes refetch harmlessly (cached).
      data: false,
      pulseWidgetIds: remote ? event.ids.slice(1) : [],
    };
  }
  if (BOARD_DATA_EVENTS.has(event.type) && event.boardId !== null && context.boardIds.includes(event.boardId)) {
    return { dashboard: false, data: true, pulseWidgetIds: [] };
  }
  return NONE;
}
