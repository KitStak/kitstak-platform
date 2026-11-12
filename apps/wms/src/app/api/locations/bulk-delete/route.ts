/** `POST /api/locations/bulk-delete { ids }` — per-id result; blocked when stock or open tasks exist. */
import { defineRoute } from '@/server/api/define-route';
import { bulkIds } from '@/lib/grid-defs/facility/common';
import { deleteLocations } from '@/server/repositories/locations';

export const POST = defineRoute({
  permission: 'settings.locations.delete',
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => await deleteLocations(db, auth, actor, body.ids),
});
