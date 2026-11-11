/** `POST /api/orders/[id]/release-block` `{ version }` — releases a workflow block (banner action). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { releaseWorkflowBlock } from "@/server/repositories/orders-commands";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: ORDER_PERMISSIONS.edit,
  params: idParamsSchema,
  body: z.object({ version: z.number().int().positive() }),
  handler: async ({ db, auth, actor, params, body }) => await releaseWorkflowBlock(db, domainCtx(actor, auth), params.id, body.version),
});
