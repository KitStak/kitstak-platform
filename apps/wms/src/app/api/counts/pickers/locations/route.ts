/** `GET /api/counts/pickers/locations?warehouseId=` - Add Location modal grid for the count wizard (grid grammar). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { listResult } from '@/server/api/envelope';
import { COUNT_PERMISSIONS as P } from '@/lib/grid-defs/counts/count-grids';
import { listPickLocations } from '@/server/repositories/counts-pickers';

export const GET = defineRoute({
  permission: [P.create, P.edit],
  query: z
    .object({
      warehouseId: z.string().min(1, 'Choose a warehouse first').max(64),
      types: z.enum(['storage', 'all']).optional(),
      exceptPlanId: z.string().max(64).optional(),
    })
    .passthrough(),
  handler: async ({ db, auth, grid, query }) => {
    const page = await listPickLocations(
      db,
      auth.scope,
      query.warehouseId,
      grid(),
      query.types === 'all',
      query.exceptPlanId || null,
    );
    return listResult(page.rows, { total: page.total, page: page.page, pageSize: page.pageSize });
  },
});
