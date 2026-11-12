/** `GET /api/lp-numbers` — LP Numbers grid (search defaults to Starts With). `POST` — From Sequence / Custom. */
import { defineRoute } from '@/server/api/define-route';
import { created, listResult } from '@/server/api/envelope';
import { lpCreateSchema } from '@/lib/grid-defs/facility/lp-numbers';
import { createLpNumbers, listLpNumbers } from '@/server/repositories/lp-numbers';

export const GET = defineRoute({
  permission: ['settings.lp_numbers.view', 'inventory.inventory_by_location.view'],
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listLpNumbers(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: 'settings.lp_numbers.create',
  body: lpCreateSchema,
  handler: async ({ db, auth, actor, body }) => created(await createLpNumbers(db, auth, actor, body)),
});
