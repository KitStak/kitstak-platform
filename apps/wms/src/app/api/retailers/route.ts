/** `GET /api/retailers` — Retailers grid (company-wide). `POST` — 3-step Create Retailer. */
import { defineRoute } from '@/server/api/define-route';
import { created, listResult } from '@/server/api/envelope';
import { retailerSchema } from '@/lib/grid-defs/organization/retailers';
import { createRetailer, listRetailers } from '@/server/repositories/retailers';

export const GET = defineRoute({
  permission: 'settings.retailers.view',
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listRetailers(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});

export const POST = defineRoute({
  permission: 'settings.retailers.create',
  body: retailerSchema,
  handler: async ({ db, auth, actor, body }) => created(await createRetailer(db, auth, actor, body)),
});
