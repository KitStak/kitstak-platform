/** `GET /api/jobs` — Job Management grid (grid grammar, scoped to the viewer's context). */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listJobs } from "@/server/repositories/jobs";

export const GET = defineRoute({
  permission: "fulfillment.job_management.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listJobs(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
