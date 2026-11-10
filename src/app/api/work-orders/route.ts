/**
 * `GET /api/work-orders` — Work Orders grid (grid grammar, viewer scope).
 * `POST /api/work-orders` — Create Work Order (wizard Save).
 */
import { defineRoute } from "@/server/api/define-route";
import { result } from "@/server/api/envelope";
import { workOrderInputSchema } from "@/lib/grid-defs/work-orders/work-order-model";
import { createWorkOrder, getWorkOrderRow, listWorkOrders } from "@/server/repositories/work-orders";
import { WO_PERMISSIONS, woCtx } from "@/server/repositories/work-orders-api";

export const GET = defineRoute({
  permission: WO_PERMISSIONS.view,
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listWorkOrders(db, auth.viewScope, query);
    return result(rows, { meta: { total, page: query.page, pageSize: query.pageSize } });
  },
});

export const POST = defineRoute({
  permission: WO_PERMISSIONS.create,
  body: workOrderInputSchema,
  handler: ({ db, auth, actor, body }) => {
    const record = createWorkOrder(db, woCtx(actor, auth), body);
    return result(getWorkOrderRow(db, auth.scope, record.id), { status: 201 });
  },
});
