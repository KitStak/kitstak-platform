/** `GET /api/billing-reports/[id]/lines` — Detailed lines grid (search, filter, sort, export). */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { listReportLines } from "@/server/repositories/billing-reports";

export const GET = defineRoute({
  permission: ["settings.billing_report.view", "settings.billing.view"],
  params: idParamsSchema,
  handler: ({ db, auth, params, grid }) => {
    const q = grid();
    const { rows, total } = listReportLines(db, auth, params.id, q);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});
