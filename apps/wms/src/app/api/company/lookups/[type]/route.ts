/** `GET /api/company/lookups/[type]` — Data Setup grid (grid grammar, usage counts). `POST` — create a value. */
import { defineRoute } from '@/server/api/define-route';
import { created, listResult } from '@/server/api/envelope';
import { lookupFormSchema } from '@/lib/grid-defs/admin/lookups';
import { createLookupValue, listLookupGrid } from '@/server/repositories/company-lookups';
import { DATA_SETUP_PERMISSION, defOf, typeParams } from '../shared';

export const GET = defineRoute({
  permission: DATA_SETUP_PERMISSION,
  params: typeParams,
  handler: async ({ db, auth, params, grid }) => {
    const query = grid();
    const { rows, total } = await listLookupGrid(db, auth, params.type, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: DATA_SETUP_PERMISSION,
  params: typeParams,
  body: lookupFormSchema,
  handler: async ({ db, auth, actor, params, body, audit }) => {
    const row = await createLookupValue(db, auth, actor, defOf(params.type), body);
    await audit({
      action: 'lookup.create',
      entity: 'lookup',
      entityId: row.id,
      detail: { type: params.type, name: row.name },
    });
    return created(row);
  },
});
