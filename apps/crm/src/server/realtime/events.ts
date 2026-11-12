/**
 * Realtime event contract (pure; shared with the client SSE consumer).
 * Events are deliberately small invalidation hints — clients refetch through the API, so no
 * data that the receiver may not be allowed to see ever travels over the wire.
 */
import { z } from 'zod';

export const REALTIME_CHANNEL = 'kitstak_events';

export const REALTIME_EVENT_TYPES = [
  'board.updated',
  'board.deleted',
  'columns.changed',
  'groups.changed',
  'views.changed',
  'items.changed',
  'items.deleted',
  'updates.changed',
  'files.changed',
  'automations.changed',
  'notifications.changed',
  'workspace.changed',
  /** Dashboard metadata, widgets or layout changed (`ids` = [dashboardId, ...widgetIds]). */
  'dashboard.changed',
] as const;
export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

export const realtimeEventSchema = z.object({
  type: z.enum(REALTIME_EVENT_TYPES),
  orgId: z.uuid(),
  boardId: z.uuid().nullable(),
  /** Affected entity ids (items, columns...), capped to keep NOTIFY payloads tiny. */
  ids: z.array(z.uuid()).max(100).default([]),
  /** Recipients for user-scoped events (notifications). */
  userIds: z.array(z.uuid()).max(50).default([]),
  actorId: z.uuid().nullable(),
  at: z.iso.datetime(),
});
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
