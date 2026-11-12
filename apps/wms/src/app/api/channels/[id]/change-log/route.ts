/** `GET /api/channels/[id]/change-log` — field-level history of a store connection. */
import { defineRoute } from '@/server/api/define-route';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { changeLogPageSchema, changeLogResult } from '@/server/repositories/integration-logs-kit';
import { loadChannelConnection } from '@/server/repositories/channels';

export const GET = defineRoute({
  permission: [
    'integrations.integrations.create_setup',
    'integrations.integrations.edit_setup',
    'integrations.integrations.delete_setup',
  ],
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: async ({ db, auth, params, query }) => {
    await loadChannelConnection(db, auth, params.id);
    return await changeLogResult(db, 'channel_connection', params.id, query);
  },
});
