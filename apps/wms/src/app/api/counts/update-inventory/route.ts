/** `POST /api/counts/update-inventory` — post counted variances of plans `{ ids, reasonId?, note?, closeBlocked? }` to the ledger. */
import { defineRoute } from '@/server/api/define-route';
import { COUNT_PERMISSIONS as P } from '@/lib/grid-defs/counts/count-grids';
import { updateInvSchema, updateInventoryForPlans } from '@/server/repositories/counts-ops';
import { domainCtx } from '@/server/repositories/platform-common';

export const POST = defineRoute({
  permission: P.updateInv,
  body: updateInvSchema,
  handler: async ({ db, auth, actor, body }) =>
    await updateInventoryForPlans(
      db,
      domainCtx(actor, auth),
      auth,
      body.ids,
      body.reasonId,
      body.note,
      body.closeBlocked ?? false,
    ),
});
