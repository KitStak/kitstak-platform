/** `GET /api/lp-types` — LP Types grid (grid grammar). `POST` — create (3-step wizard). */
import { defineRoute } from '@/server/api/define-route';
import { created, listResult } from '@/server/api/envelope';
import { lpTypeSchema } from '@/lib/grid-defs/facility/lp-types';
import { createLpType, listLpTypes } from '@/server/repositories/lp-types';

export const GET = defineRoute({
  permission: [
    'settings.lp_types.view',
    'settings.lp_numbers.view',
    'settings.locations.view',
    'inventory.inventory_by_location.view',
  ],
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listLpTypes(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: 'settings.lp_types.create',
  body: lpTypeSchema,
  handler: async ({ db, auth, actor, body }) => created(await createLpType(db, auth, actor, body)),
});
