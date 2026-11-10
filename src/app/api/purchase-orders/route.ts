/**
 * `/api/purchase-orders` — PO list (grid grammar: q/qm, f.*, sort, page, ps) and create
 * (5-step wizard payload). Scoped to the caller's warehouses/clients.
 */
import { created, listResult } from "@/server/api/envelope";
import { defineRoute } from "@/server/api/define-route";
import { poCreateSchema } from "@/lib/grid-defs/receiving/po-schemas";
import { domainCtx } from "@/server/repositories/platform-common";
import { listPurchaseOrders } from "@/server/repositories/purchase-orders";
import { createPurchaseOrder } from "@/server/repositories/purchase-orders-commands";

export const GET = defineRoute({
  permission: "inventory.purchase_orders.view",
  handler: ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = listPurchaseOrders(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: "inventory.purchase_orders.create",
  body: poCreateSchema,
  handler: ({ db, auth, actor, body }) => created(createPurchaseOrder(db, domainCtx(actor, auth), auth.scope, body)),
});
