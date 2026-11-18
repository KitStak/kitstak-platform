/** `GET /api/clients/:id/pulse`: KitStak Pulse profit for this client (shared core customer), last 30 days. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { getClientPulse } from '@/server/pulse/bridge';

export const GET = defineRoute({
  permission: 'settings.clients.view',
  params: z.object({ id: z.uuid() }),
  handler: async ({ db, auth, params }) => await getClientPulse(db, auth, params.id),
});
