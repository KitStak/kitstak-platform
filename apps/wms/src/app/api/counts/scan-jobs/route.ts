/** `GET /api/counts/scan-jobs?view=mine|pool` - handheld Cycle Count "Your jobs" / "Job pool" (Logiwa mobile parity). */
import { defineRoute } from '@/server/api/define-route';
import { COUNT_EXECUTE_PERMISSIONS, COUNT_PERMISSIONS as P } from '@/lib/grid-defs/counts/count-grids';
import { listScanJobs, scanJobsQuerySchema } from '@/server/repositories/counts-scan-jobs';

export const GET = defineRoute({
  permission: [P.mobileYourJobs, P.mobileJobPool, ...COUNT_EXECUTE_PERMISSIONS],
  query: scanJobsQuerySchema,
  transaction: false,
  rateLimit: false,
  handler: async ({ db, auth, query }) => await listScanJobs(db, auth, query.view),
});
