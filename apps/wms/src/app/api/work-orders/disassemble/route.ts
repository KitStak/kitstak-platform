/** `POST /api/work-orders/disassemble`: ledger Disassemble Kit + DisassembleKit receipts. */
import { defineRoute } from "@/server/api/define-route";
import { disassembleSchema } from "@/lib/grid-defs/work-orders/work-order-model";
import { getWorkOrderRow } from "@/server/repositories/work-orders";
import { WO_PERMISSIONS, woCtx } from "@/server/repositories/work-orders-api";
import { disassembleKit } from "@/server/repositories/work-orders-commands";

export const POST = defineRoute({
  permission: WO_PERMISSIONS.disassemble,
  body: disassembleSchema,
  handler: async ({ db, auth, actor, body }) => {
    const res = await disassembleKit(db, woCtx(actor, auth), body);
    return { ...res, workOrder: await getWorkOrderRow(db, auth.scope, res.workOrderId) };
  },
});
