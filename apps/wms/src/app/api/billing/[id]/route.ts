/** `GET|PATCH|DELETE /api/billing/[id]` — contract with fees, header edit (optimistic `version`), guarded delete. */
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { contractSchema } from '@/lib/grid-defs/organization/billing';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { deleteContracts, getContract, updateContract } from '@/server/repositories/billing';
import { nextAutoRun } from '@/server/repositories/billing-reports';

export const GET = defineRoute({
  permission: 'settings.billing.view',
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => {
    const contract = await getContract(db, auth, params.id);
    // When the period-end scheduler next bills this contract (null while Draft).
    return { ...contract, nextAutoRun: await nextAutoRun(db, contract) };
  },
});

export const PATCH = defineRoute({
  permission: 'settings.billing.edit',
  params: idParamsSchema,
  body: contractSchema,
  handler: async ({ db, auth, actor, params, body }) =>
    await updateContract(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: 'settings.billing.delete',
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => {
    const result = await deleteContracts(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure)
      throw new AppError(failure.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_STATE', failure.message);
    return result;
  },
});
