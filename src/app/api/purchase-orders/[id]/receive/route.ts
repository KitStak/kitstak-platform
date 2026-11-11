/**
 * `POST /api/purchase-orders/[id]/receive` — Receive Items (partial receive per line) or,
 * with `{ all: true }`, a full receive into the warehouse's default receiving location.
 * A line without `locationId` is received into the default receiving location as well.
 */
import { defineRoute } from "@/server/api/define-route";
import { receiveApiBodySchema } from "@/lib/grid-defs/receiving/po-schemas";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";
import { receiveFromApi } from "@/server/repositories/purchase-orders-receive";

export const POST = defineRoute({
  permission: "inventory.purchase_orders.receive_po",
  params: idParamsSchema,
  body: receiveApiBodySchema,
  handler: async ({ db, auth, actor, params, body }) => await receiveFromApi(db, domainCtx(actor, auth), auth.scope, params.id, body),
});
