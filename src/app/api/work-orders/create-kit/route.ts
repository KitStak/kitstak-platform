/** `POST /api/work-orders/create-kit`: build kits (ledger Kitting + Kitting receipt). */
import { defineRoute } from "@/server/api/define-route";
import { createKitSchema } from "@/lib/grid-defs/work-orders/work-order-model";
import { getWorkOrderRow } from "@/server/repositories/work-orders";
import { WO_PERMISSIONS, woCtx } from "@/server/repositories/work-orders-api";
import { createKit } from "@/server/repositories/work-orders-commands";

export const POST = defineRoute({
  permission: WO_PERMISSIONS.createKit,
  body: createKitSchema,
  handler: ({ db, auth, actor, body }) => {
    const res = createKit(db, woCtx(actor, auth), body);
    return { ...res, workOrder: getWorkOrderRow(db, auth.scope, res.workOrderId) };
  },
});
