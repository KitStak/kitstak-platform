/** `PATCH,DELETE /api/orders/[id]/lines/[lineId]` — edit (`{ version, patch }`) or remove (`?version=`) one line. */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { orders } from "@/server/domain";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { changeLine } from "@/server/repositories/orders-commands";
import { domainCtx, idSchema } from "@/server/repositories/platform-common";

const params = z.object({ id: idSchema, lineId: idSchema });

export const PATCH = defineRoute({
  permission: ORDER_PERMISSIONS.edit,
  params,
  body: z.object({ version: z.number().int().positive(), patch: orders.orderLineInputSchema.partial() }),
  handler: async ({ db, auth, actor, params: p, body }) => await changeLine(db, domainCtx(actor, auth), p.id, body.version, { kind: "edit", lineId: p.lineId, patch: body.patch }),
});

export const DELETE = defineRoute({
  permission: ORDER_PERMISSIONS.edit,
  params,
  query: z.object({ version: z.coerce.number().int().positive() }),
  handler: async ({ db, auth, actor, params: p, query }) => await changeLine(db, domainCtx(actor, auth), p.id, query.version, { kind: "delete", lineId: p.lineId }),
});
