/** `POST /api/counts/cancel` — cancel plans `{ ids }`; open lines and pending tasks are cancelled and the locations unlock. */
import { defineRoute } from "@/server/api/define-route";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { cancelCountPlans, idsSchema } from "@/server/repositories/counts-ops";
import { domainCtx } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: P.cancel,
  body: idsSchema,
  handler: ({ db, auth, actor, body }) => cancelCountPlans(db, domainCtx(actor, auth), auth, body.ids),
});
