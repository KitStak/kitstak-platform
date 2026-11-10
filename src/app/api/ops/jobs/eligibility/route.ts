/**
 * `POST /api/ops/jobs/eligibility` `{ operation, orderIds, jobTypeId | jobId }` — dry run:
 * "X of Y orders are eligible" with a per-order reason list. Nothing is written.
 */
import { defineRoute } from "@/server/api/define-route";
import { domainCtx } from "@/server/repositories/platform-common";
import { ANY_JOB_OPERATION_PERMISSION, checkEligibility, eligibilitySchema } from "@/server/repositories/platform-ops";

export const POST = defineRoute({
  permission: ANY_JOB_OPERATION_PERMISSION,
  body: eligibilitySchema,
  handler: ({ db, auth, actor, body }) => checkEligibility(db, auth, domainCtx(actor, auth), body),
});
