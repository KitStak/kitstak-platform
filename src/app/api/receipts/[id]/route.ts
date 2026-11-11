/** `GET /api/receipts/[id]` — receipt detail (Master Id drawer). */
import { defineRoute } from "@/server/api/define-route";
import { idParamsSchema } from "@/server/repositories/platform-common";
import { getReceipt } from "@/server/repositories/receipts";

export const GET = defineRoute({
  permission: ["inventory.receiving_history.view", "inventory.purchase_orders.view"],
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getReceipt(db, auth.scope, params.id),
});
