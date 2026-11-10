/** `GET /api/shortages` — Shortage Report grid (open shortage lines). */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listShortages } from "@/server/repositories/waves";

export const GET = defineRoute({
  permission: "reports.shortage_report.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listShortages(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
