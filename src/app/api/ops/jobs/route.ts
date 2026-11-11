/**
 * `POST /api/ops/jobs` — Create Job modal backend (BUILD_PLAN F4 create-job-modal).
 *   { mode: "create", operation, orderIds, jobTypeId, batchSize?, assigneeUserId?, priority? }
 *   { mode: "merge", operation, jobId, orderIds }
 *   { mode: "work-order", workOrderIds }   (M08 stub until replaced)
 *   { mode: "count", countPlanIds }        (M07, not configured yet)
 * Returns `{ succeeded, failed, jobIds }`.
 */
import { defineRoute } from "@/server/api/define-route";
import { domainCtx } from "@/server/repositories/platform-common";
import { ANY_JOB_OPERATION_PERMISSION, opsJobsSchema, runJobsCommand } from "@/server/repositories/platform-ops";

export const POST = defineRoute({
  permission: ANY_JOB_OPERATION_PERMISSION,
  body: opsJobsSchema,
  handler: async ({ db, auth, actor, body }) => await runJobsCommand(db, auth, domainCtx(actor, auth), body),
});
