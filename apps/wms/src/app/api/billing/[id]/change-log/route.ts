/** `GET /api/billing/[id]/change-log` — header and fee history of one billing form. */
import { defineRoute } from '@/server/api/define-route';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { changeLogPageSchema, changeLogResult } from '@/server/repositories/locations-shared';
import { CONTRACT_ENTITY, loadContract } from '@/server/repositories/billing';

export const GET = defineRoute({
  permission: ['settings.billing.change_log', 'settings.billing.view'],
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: async ({ db, auth, params, query }) => {
    await loadContract(db, auth, params.id);
    return await changeLogResult(db, CONTRACT_ENTITY, params.id, query);
  },
});
