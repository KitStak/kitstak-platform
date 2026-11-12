/** `GET /api/counts/locations` — Count Locationlocations Details grid (grid grammar). */
import { defineRoute } from '@/server/api/define-route';
import { listResult } from '@/server/api/envelope';
import { COUNT_PERMISSIONS as P } from '@/lib/grid-defs/counts/count-grids';
import { listCountLines } from '@/server/repositories/counts-lines';

export const GET = defineRoute({
  permission: P.locView,
  handler: async ({ db, auth, grid }) => {
    const page = await listCountLines(db, auth.viewScope, 'locations', grid());
    return listResult(page.rows, { total: page.total, page: page.page, pageSize: page.pageSize });
  },
});
