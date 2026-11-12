/** `GET /api/monitoring/recent-errors?tz` — order download errors of the last 14 days, grouped per local day. */
import { defineRoute } from '@/server/api/define-route';
import { listResult } from '@/server/api/envelope';
import { listRecentErrors } from '@/server/repositories/monitoring';

export const GET = defineRoute({
  permission: 'integrations.integration_monitoring.view',
  handler: async ({ db, auth, grid, searchParams }) => {
    const q = grid();
    const { rows, total } = await listRecentErrors(db, auth, q, searchParams.get('tz'));
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});
