/** `POST /api/counts/lines/cancel` - cancel open count lines `{ ids }` (Location / SKU Details). */
import { defineRoute } from "@/server/api/define-route";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { cancelCountLines, idsSchema } from "@/server/repositories/counts-ops";
import { domainCtx } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: [P.locCancel, P.skuCancel],
  body: idsSchema,
  handler: ({ db, auth, actor, body }) => cancelCountLines(db, domainCtx(actor, auth), auth, body.ids),
});
