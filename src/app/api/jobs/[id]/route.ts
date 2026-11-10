/** `GET /api/jobs/[id]` — job detail: header, progress, orders, tasks (pick path order). */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { getJobDetail } from "@/server/repositories/jobs";

export const GET = defineRoute({
  permission: "fulfillment.job_management.view",
  params: idParamsSchema,
  handler: ({ db, auth, params }) => getJobDetail(db, auth, params.id),
});
