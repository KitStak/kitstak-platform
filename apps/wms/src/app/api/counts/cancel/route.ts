/**
 * `POST /api/counts/cancel` — cancel plans `{ ids, reason? }`; open and counted (not posted) lines and
 * pending tasks are cancelled and the locations unlock. Discarding counted lines requires `reason`.
 */
import { defineRoute } from '@/server/api/define-route';
import { COUNT_PERMISSIONS as P } from '@/lib/grid-defs/counts/count-grids';
import { cancelCountPlans, cancelSchema } from '@/server/repositories/counts-ops';
import { domainCtx } from '@/server/repositories/platform-common';

export const POST = defineRoute({
  permission: P.cancel,
  body: cancelSchema,
  handler: async ({ db, auth, actor, body }) =>
    await cancelCountPlans(db, domainCtx(actor, auth), auth, body.ids, body.reason),
});
