/** `GET /api/clients/:id/projects`: KitStak Projects health for this client (shared core customer). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { getClientProjects } from '@/server/projects/bridge';

export const GET = defineRoute({
  permission: 'settings.clients.view',
  params: z.object({ id: z.uuid() }),
  handler: async ({ db, auth, params }) => await getClientProjects(db, auth, params.id),
});
