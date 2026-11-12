/** `POST /api/lp-numbers/removal-preview { ids }` — read-only: what Delete would do to each LP (delete / void / blocked + reason). */
import { defineRoute } from '@/server/api/define-route';
import { bulkIds } from '@/lib/grid-defs/facility/common';
import { lpRemovalPreview } from '@/server/repositories/lp-numbers';

export const POST = defineRoute({
  permission: ['settings.lp_numbers.view', 'inventory.inventory_by_location.view'],
  body: bulkIds,
  handler: async ({ db, auth, body }) => await lpRemovalPreview(db, auth, body.ids),
});
