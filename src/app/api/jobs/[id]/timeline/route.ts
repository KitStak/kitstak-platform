/**
 * `GET /api/jobs/[id]/timeline?page&ps` — the job's change log, newest first, with the actor's
 * display name (critic R4: the shared timeline showed the raw source email). The raw source
 * stays in `sourceDetail` for a tooltip.
 */
import { defineRoute } from "@/server/api/define-route";
import { listResult } from "@/server/api/envelope";
import { idParamsSchema, pagingSchema } from "@/server/repositories/platform-common";
import { loadJob } from "@/server/repositories/jobs";
import { listEntityChangeLog } from "@/server/repositories/wave-rules";
import { withBusyRetry } from "@/server/repositories/jobs-read-retry";

export const GET = defineRoute({
  permission: "fulfillment.job_management.view",
  params: idParamsSchema,
  query: pagingSchema,
  handler: async ({ db, auth, params, query }) => {
    await loadJob(db, auth, params.id);
    const { rows, total } = await withBusyRetry(async () => await listEntityChangeLog(db, "job", params.id, query.page, query.ps));
    return listResult(rows, { total, page: query.page, pageSize: query.ps });
  },
});
