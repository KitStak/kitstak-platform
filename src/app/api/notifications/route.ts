/** `GET /api/notifications?unread=&page=&ps=` — the caller's notifications (meta.unread = badge). */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listNotifications, notificationListQuerySchema } from "@/server/repositories/platform-activity";

export const GET = defineRoute({
  query: notificationListQuerySchema,
  handler: ({ db, auth, query }) => {
    const { rows, total, unread } = listNotifications(db, auth.user.id, query);
    return listResult(rows, { total, page: query.page, pageSize: query.ps, unread });
  },
});
