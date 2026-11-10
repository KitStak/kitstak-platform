/** `GET,PATCH,DELETE /api/orders/[id]` — detail (id or code), update (409 on stale version), soft delete. */
import { defineRoute } from "@/server/api/define-route";
import { AppError, isErrorCode, notFoundError } from "@/server/api/errors";
import { orders } from "@/server/domain";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { getOrderDetail } from "@/server/repositories/orders";
import { updateOrder, updateOrderBodySchema } from "@/server/repositories/orders-commands";
import { domainCtx, idParamsSchema } from "@/server/repositories/platform-common";

export const GET = defineRoute({
  permission: ORDER_PERMISSIONS.view,
  params: idParamsSchema,
  handler: ({ db, auth, params }) => {
    const detail = getOrderDetail(db, auth, params.id);
    if (!detail) throw notFoundError("Shipment order");
    return detail;
  },
});

export const PATCH = defineRoute({
  permission: ORDER_PERMISSIONS.edit,
  params: idParamsSchema,
  body: updateOrderBodySchema,
  handler: ({ db, auth, actor, params, body }) => updateOrder(db, domainCtx(actor, auth), params.id, body),
});

export const DELETE = defineRoute({
  permission: ORDER_PERMISSIONS.delete,
  params: idParamsSchema,
  handler: ({ db, auth, actor, params }) => {
    const result = orders.deleteOrders(db, domainCtx(actor, auth), { ids: [params.id] });
    const failure = result.failed[0];
    if (failure) throw new AppError(isErrorCode(failure.code) ? failure.code : "INVALID_STATE", failure.message);
    return { deleted: true };
  },
});
