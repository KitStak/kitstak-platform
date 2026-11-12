/** `GET /api/channels/options` — store setups for dropdowns and filters. */
import { defineRoute } from '@/server/api/define-route';
import { connectionOptions } from '@/server/repositories/channels';

export const GET = defineRoute({
  permission: [
    'integrations.integrations.create_setup',
    'integrations.integrations.edit_setup',
    'integrations.integrations.delete_setup',
    'integrations.integration_logs.view',
    'integrations.integration_monitoring.view',
  ],
  handler: async ({ db, auth }) => await connectionOptions(db, auth),
});
