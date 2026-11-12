/** `GET /api/vas-operations` — VAS Operations grid. `POST` — Create a VAS operation (calculation type from the VAS type). */
import { defineRoute } from '@/server/api/define-route';
import { created, listResult } from '@/server/api/envelope';
import { vasSchema } from '@/lib/grid-defs/organization/vas';
import { createVas, listVas } from '@/server/repositories/vas';

export const GET = defineRoute({
  permission: 'settings.vas_operations.view',
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listVas(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: 'settings.vas_operations.create',
  body: vasSchema,
  handler: async ({ db, auth, actor, body }) => created(await createVas(db, auth, actor, body)),
});
