/** `GET /api/locations/[id]/contents` — buckets, open tasks and ledger history for the detail page. */
import { defineRoute } from '@/server/api/define-route';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { getLocationContents } from '@/server/repositories/locations';

export const GET = defineRoute({
  permission: ['settings.locations.view', 'inventory.inventory_by_location.view'],
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getLocationContents(db, auth, params.id),
});
