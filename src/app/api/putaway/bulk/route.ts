/**
 * `POST /api/putaway/bulk` `{ items: [{ inventoryId, version? }], locationCode? }` — put the selected
 * receiving-area stock away in full: every task to the scanned location, or each to its top suggestion.
 * Per-task savepoints: a failing task is reported and the rest still move.
 */
import { defineRoute } from "@/server/api/define-route";
import { domainCtx } from "@/server/repositories/platform-common";
import { bulkPutaway, bulkPutawaySchema } from "@/server/repositories/putaway-worklist";

export const POST = defineRoute({
  permission: "inventory.inventory_by_location.transfer_product",
  body: bulkPutawaySchema,
  handler: ({ db, auth, actor, body }) => bulkPutaway(db, auth, domainCtx(actor, auth), body),
});
