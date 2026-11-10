/** `GET /api/jobs` — Job Management grid (grid grammar, scoped to the viewer's context). */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { listJobs } from "@/server/repositories/jobs";
import { withBusyRetry } from "@/server/repositories/jobs-read-retry";
import { sweepDeadJobs } from "@/server/repositories/jobs-settle";

export const GET = defineRoute({
  permission: "fulfillment.job_management.view",
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    // Self-heal (throttled): jobs whose last live task was cancelled elsewhere close before they are listed.
    sweepDeadJobs(db);
    const { rows, total } = await withBusyRetry(() => listJobs(db, auth, query));
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
