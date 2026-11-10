/** `GET /api/monitoring/recent-errors` — order download errors of the last 14 days, grouped. */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listRecentErrors } from "@/server/repositories/monitoring";

export const GET = defineRoute({
  permission: "integrations.integration_monitoring.view",
  handler: ({ db, auth, grid }) => {
    const q = grid();
    const { rows, total } = listRecentErrors(db, auth, q);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});
