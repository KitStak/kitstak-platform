/** `GET|PATCH|DELETE /api/channels/[id]` — Show Details, Edit Store Connection (4 tabs), guarded delete. */
import { defineRoute } from '@/server/api/define-route';
import { AppError } from '@/server/api/errors';
import { editStoreSchema } from '@/lib/grid-defs/integrations/channels';
import { idParamsSchema } from '@/server/repositories/platform-common';
import {
  deleteChannelConnections,
  getChannelConnection,
  updateChannelConnection,
} from '@/server/repositories/channels';

export const GET = defineRoute({
  permission: [
    'integrations.integrations.create_setup',
    'integrations.integrations.edit_setup',
    'integrations.integrations.delete_setup',
    'integrations.integration_logs.view',
    'integrations.integration_monitoring.view',
  ],
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getChannelConnection(db, auth, params.id),
});

export const PATCH = defineRoute({
  permission: 'integrations.integrations.edit_setup',
  params: idParamsSchema,
  body: editStoreSchema,
  transaction: false,
  handler: async ({ db, auth, actor, params, body }) =>
    updateChannelConnection(db, auth, actor, params.id, body),
});

export const DELETE = defineRoute({
  permission: 'integrations.integrations.delete_setup',
  params: idParamsSchema,
  handler: async ({ db, auth, actor, params }) => {
    const result = await deleteChannelConnections(db, auth, actor, [params.id]);
    const failure = result.failed[0];
    if (failure)
      throw new AppError(failure.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_STATE', failure.message);
    return result;
  },
});
