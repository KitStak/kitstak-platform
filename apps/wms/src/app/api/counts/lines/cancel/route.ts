/** `POST /api/counts/lines/cancel` - cancel open or counted (not posted) count lines `{ ids, reason? }`; discarding a count needs `reason`. */
import { defineRoute } from "@/server/api/define-route";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { cancelCountLines, cancelSchema } from "@/server/repositories/counts-ops";
import { domainCtx } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: [P.locCancel, P.skuCancel],
  body: cancelSchema,
  handler: async ({ db, auth, actor, body }) => await cancelCountLines(db, domainCtx(actor, auth), auth, body.ids, body.reason),
});
