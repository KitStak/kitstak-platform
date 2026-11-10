/** `POST /api/counts/lines/update-inventory` - post counted lines `{ ids, reasonId?, note?, closeBlocked? }` to the ledger. */
import { defineRoute } from "@/server/api/define-route";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { updateInvSchema, updateInventoryForLines } from "@/server/repositories/counts-ops";
import { domainCtx } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: [P.locUpdateInv, P.skuUpdateInv, P.updateInv],
  body: updateInvSchema,
  handler: ({ db, auth, actor, body }) => updateInventoryForLines(db, domainCtx(actor, auth), auth, body.ids, body.reasonId, body.note, body.closeBlocked ?? false),
});
