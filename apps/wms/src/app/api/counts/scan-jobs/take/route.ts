/** `POST /api/counts/scan-jobs/take` - Take job `{ jobId }`: assigns an unassigned count job from the pool to the signed-in counter. */
import { defineRoute } from '@/server/api/define-route';
import { COUNT_PERMISSIONS as P } from '@/lib/grid-defs/counts/count-grids';
import { takeJobSchema, takeScanJob } from '@/server/repositories/counts-scan-jobs';
import { domainCtx } from '@/server/repositories/platform-common';

export const POST = defineRoute({
  permission: [P.mobileJobPool, P.edit, P.updateInv],
  body: takeJobSchema,
  handler: async ({ db, auth, actor, body }) =>
    await takeScanJob(db, domainCtx(actor, auth), auth, body.jobId),
});
