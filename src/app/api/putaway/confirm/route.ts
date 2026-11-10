/** `POST /api/putaway/confirm` `{ inventoryId, locationCode, qty, version? }` — move received stock to the scanned location. */
import { defineRoute } from "@/server/api/define-route";
import { domainCtx } from "@/server/repositories/platform-common";
import { confirmPutaway, confirmPutawaySchema } from "@/server/repositories/putaway-worklist";

export const POST = defineRoute({
  permission: "inventory.inventory_by_location.transfer_product",
  body: confirmPutawaySchema,
  handler: ({ db, auth, actor, body }) => confirmPutaway(db, auth, domainCtx(actor, auth), body),
});
