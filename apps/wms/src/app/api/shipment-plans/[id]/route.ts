/** `GET|PATCH|DELETE /api/shipment-plans/[id]` — plan detail, edit (version-checked), delete (Open only). */
import { defineRoute } from '@/server/api/define-route';
import { AppError, isErrorCode } from '@/server/api/errors';
import { domainCtx, idParamsSchema } from '@/server/repositories/platform-common';
import { deletePlans, updatePlan, updatePlanSchema } from '@/server/repositories/shipment-plans';
import { getPlanDetail } from '@/server/repositories/shipment-plans-lists';

export const GET = defineRoute({
  permission: 'fulfillment.shipment_plan.view',
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getPlanDetail(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: 'fulfillment.shipment_plan.edit',
  params: idParamsSchema,
  body: updatePlanSchema,
  handler: async ({ db, auth, actor, params, body }) =>
    await updatePlan(db, auth, domainCtx(actor, auth), params.id, body),
});

export const DELETE = defineRoute({
  permission: 'fulfillment.shipment_plan.delete',
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => {
    const result = await deletePlans(db, auth, domainCtx(actor, auth), [params.id]);
    const failure = result.failed[0];
    if (failure)
      throw new AppError(isErrorCode(failure.code) ? failure.code : 'INVALID_STATE', failure.message);
    return result;
  },
});
