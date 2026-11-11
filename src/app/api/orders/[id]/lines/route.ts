/** `POST /api/orders/[id]/lines` `{ version, line }` — adds a line (Open / Shortage / On Hold, unallocated). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { created } from "@/server/api/envelope";
import { orders } from "@/server/domain";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { changeLine } from "@/server/repositories/orders-commands";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";

export const POST = defineRoute({
  permission: ORDER_PERMISSIONS.edit,
  params: idParamsSchema,
  body: z.object({ version: z.number().int().positive(), line: orders.orderLineInputSchema }),
  handler: async ({ db, auth, actor, params, body }) => created(await changeLine(db, domainCtx(actor, auth), params.id, body.version, { kind: "add", line: body.line })),
});
