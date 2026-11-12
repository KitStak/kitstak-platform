/** `POST /api/receipts/[id]/cancel` — reverses the receipt through the ledger (blocked on Completed POs). */
import { defineRoute } from '@/server/api/define-route';
import { domainCtx, idParamsSchema } from '@/server/repositories/platform-common';
import { cancelReceipt } from '@/server/repositories/receipts';

export const POST = defineRoute({
  permission: 'inventory.receiving_history.cancel',
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) =>
    await cancelReceipt(db, domainCtx(actor, auth), auth.scope, params.id),
});
