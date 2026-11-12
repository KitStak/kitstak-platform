/** `PATCH /api/counts/[id]/header` - rename / re-describe a count plan at any status (409 on stale version). */
import { defineRoute } from "@/server/api/define-route";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { countPlanHeaderSchema, updateCountPlanHeader } from "@/server/repositories/counts-plans";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";

export const PATCH = defineRoute({
  permission: P.edit,
  params: idParamsSchema,
  body: countPlanHeaderSchema,
  handler: async ({ db, auth, actor, params, body }) => await updateCountPlanHeader(db, domainCtx(actor, auth), auth, params.id, body),
});
