/** `GET /api/background-tasks?kind=&status=&page=&ps=` — Transactions tray / Export History (own tasks). */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { backgroundTaskListQuerySchema, listBackgroundTasks } from "@/server/repositories/platform-activity";

export const GET = defineRoute({
  query: backgroundTaskListQuerySchema,
  handler: ({ db, auth, query }) => {
    const { rows, total } = listBackgroundTasks(db, auth.user.id, query);
    return listResult(rows, { total, page: query.page, pageSize: query.ps });
  },
});
