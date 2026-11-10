/** `POST /api/counts/create-job` — Create Job for Pending plans: `{ ids, jobTypeId, batchSize, assigneeUserId? }` → `{ succeeded, failed, jobIds }`. */
import { defineRoute } from "@/server/api/define-route";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { createCountJobs, createCountJobSchema } from "@/server/repositories/counts-jobs";
import { domainCtx } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: P.createJob,
  body: createCountJobSchema,
  handler: ({ db, auth, actor, body }) => createCountJobs(db, domainCtx(actor, auth), auth, body),
});
