/** `GET /api/jobs/[id]` — job detail: header, progress, orders, tasks (pick path order). */
import { withBusyRetry } from "@/server/repositories/jobs-read-retry";
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { getJobDetail } from "@/server/repositories/jobs";
import { settleDeadJobs } from "@/server/repositories/jobs-settle";
import { systemCtx } from "@/server/domain/types";

export const GET = defineRoute({
  permission: "fulfillment.job_management.view",
  params: idParamsSchema,
  handler: ({ db, auth, params }) => withBusyRetry(() => {
    try { settleDeadJobs(db, systemCtx("System"), [params.id]); } catch { /* best effort; the read still answers */ }
    return getJobDetail(db, auth, params.id);
  }),
});
