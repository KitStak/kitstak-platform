/** `GET /api/rate-shopping-presets` — grid (grid grammar). `POST` — create. */
import { defineRoute } from '@/server/api/define-route';
import { created, listResult } from '@/server/api/envelope';
import { presetSaveSchema } from '@/lib/grid-defs/integrations/rate-shopping';
import { createPreset, listPresets } from '@/server/repositories/rate-shopping';

export const GET = defineRoute({
  permission: 'automation.rate_shopping.view',
  handler: async ({ db, auth, grid }) => {
    const q = grid();
    const { rows, total } = await listPresets(db, auth, q);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});

export const POST = defineRoute({
  permission: 'automation.rate_shopping.create',
  body: presetSaveSchema,
  handler: async ({ db, auth, actor, body }) => created(await createPreset(db, auth, actor, body)),
});
