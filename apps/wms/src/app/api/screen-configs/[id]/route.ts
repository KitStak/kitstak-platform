/** `GET|PATCH|DELETE /api/screen-configs/[id]` — detail, edit (optimistic `version`), delete. */
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { screenConfigSchema } from '@/lib/grid-defs/admin/screen-configs';
import { idParamsSchema } from '@/server/repositories/platform-common';
import {
  deleteScreenConfigs,
  loadScreenConfig,
  updateScreenConfig,
} from '@/server/repositories/screen-configs';

export const GET = defineRoute({
  permission: 'settings.screen_configuration.view',
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await loadScreenConfig(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: 'settings.screen_configuration.edit',
  params: idParamsSchema,
  body: screenConfigSchema,
  handler: async ({ db, auth, actor, params, body }) =>
    await updateScreenConfig(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: 'settings.screen_configuration.delete',
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => {
    const result = await deleteScreenConfigs(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure)
      throw new AppError(failure.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_STATE', failure.message);
    return result;
  },
});
