/** `GET /api/change-log?entityType=&entityId=&page=&ps=` — paged field-level history. */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { changeLogQuerySchema, listChangeLog } from "@/server/repositories/platform-change-log";

export const GET = defineRoute({
  query: changeLogQuerySchema,
  handler: ({ db, auth, query }) => {
    const { rows, total } = listChangeLog(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.ps });
  },
});
