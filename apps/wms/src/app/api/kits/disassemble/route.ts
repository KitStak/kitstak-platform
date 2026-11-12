/** `POST /api/kits/disassemble`: standalone Disassemble Kit (no work order) by the kit's BOM. */
import { defineRoute } from '@/server/api/define-route';
import { disassembleStockSchema } from '@/lib/grid-defs/work-orders/work-order-model';
import { WO_PERMISSIONS, woCtx } from '@/server/repositories/work-orders-api';
import { disassembleStockKit } from '@/server/repositories/work-orders-commands';

export const POST = defineRoute({
  permission: WO_PERMISSIONS.disassemble,
  body: disassembleStockSchema,
  handler: async ({ db, auth, actor, body }) => await disassembleStockKit(db, woCtx(actor, auth), body),
});
