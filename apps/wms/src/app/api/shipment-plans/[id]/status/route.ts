/** `POST /api/shipment-plans/[id]/status` `{ status, version? }` — legal transitions only (state machine). */
import { defineRoute } from '@/server/api/define-route';
import { domainCtx, idParamsSchema } from '@/server/repositories/platform-common';
import { changePlanStatus, planStatusSchema } from '@/server/repositories/shipment-plans';

export const POST = defineRoute({
  permission: 'fulfillment.shipment_plan.change_status',
  params: idParamsSchema,
  body: planStatusSchema,
  handler: async ({ db, auth, actor, params, body }) =>
    await changePlanStatus(db, auth, domainCtx(actor, auth), params.id, body.status, body.version),
});
