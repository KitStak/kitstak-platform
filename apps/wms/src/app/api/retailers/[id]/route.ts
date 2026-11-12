/** `GET|PATCH|DELETE /api/retailers/[id]` — detail, edit (optimistic `version`), delete (blocked while orders reference it). */
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { retailerSchema } from '@/lib/grid-defs/organization/retailers';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { deleteRetailers, getRetailer, updateRetailer } from '@/server/repositories/retailers';

export const GET = defineRoute({
  permission: 'settings.retailers.view',
  params: idParamsSchema,
  handler: async ({ db, params }) => await getRetailer(db, params.id),
});

export const PATCH = defineRoute({
  permission: 'settings.retailers.edit',
  params: idParamsSchema,
  body: retailerSchema,
  handler: async ({ db, auth, actor, params, body }) =>
    await updateRetailer(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: 'settings.retailers.delete',
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => {
    const result = await deleteRetailers(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure)
      throw new AppError(failure.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_STATE', failure.message);
    return result;
  },
});
