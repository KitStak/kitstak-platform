/**
 * `GET /api/notifications?unread=&type=&severity=&since=&page=&ps=` — the caller's notifications
 * (meta.unread = badge, meta.types = type groups for the filter chips).
 * `DELETE /api/notifications` `{ ids }` or `{ read: true }` — removes the caller's own rows.
 */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { notificationDeleteSchema } from "@/lib/grid-defs/admin/notifications";
import { deleteNotifications, listNotifications, notificationListQuerySchema } from "@/server/repositories/platform-activity";

export const GET = defineRoute({
  query: notificationListQuerySchema,
  handler: ({ db, auth, query }) => {
    const { rows, total, unread, types } = listNotifications(db, auth.user.id, query);
    return listResult(rows, { total, page: query.page, pageSize: query.ps, unread, types });
  },
});

export const DELETE = defineRoute({
  body: notificationDeleteSchema,
  handler: ({ db, auth, body }) => deleteNotifications(db, auth.user.id, body),
});
