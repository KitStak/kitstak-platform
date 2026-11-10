/** `GET|PATCH|DELETE /api/job-types/[id]` — delete is blocked while rules or open jobs use the type. */
import { defineRoute } from "@/server/api/define-route";
import { jobTypeInputSchema } from "@/lib/grid-defs/jobs/forms";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { deleteJobType, getJobTypeDetail, updateJobType } from "@/server/repositories/job-types";

export const GET = defineRoute({
  permission: ["settings.job_types.view", "automation.wave_rules.view"],
  params: idParamsSchema,
  handler: ({ db, auth, params }) => getJobTypeDetail(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: "settings.job_types.edit",
  params: idParamsSchema,
  body: jobTypeInputSchema,
  handler: ({ db, auth, actor, params, body }) => updateJobType(db, auth, domainCtx(actor, auth), params.id, body),
});

export const DELETE = defineRoute({
  permission: "settings.job_types.delete",
  params: idParamsSchema,
  handler: ({ db, auth, actor, params }) => {
    deleteJobType(db, auth, domainCtx(actor, auth), params.id);
    return { deleted: params.id };
  },
});
