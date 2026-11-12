/** `GET /api/channels/[id]/locations` — the store's fulfillment locations (live). */
import { defineRoute } from '@/server/api/define-route';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { storeLocations } from '@/server/repositories/channels';

export const GET = defineRoute({
  permission: [
    'integrations.integrations.create_setup',
    'integrations.integrations.edit_setup',
    'integrations.integrations.delete_setup',
  ],
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => storeLocations(db, auth, params.id),
});
