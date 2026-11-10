/** `GET /api/waves` — Wave Log Report grid. */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listWaves } from "@/server/repositories/waves";

export const GET = defineRoute({
  permission: "reports.wave_log_report.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listWaves(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
