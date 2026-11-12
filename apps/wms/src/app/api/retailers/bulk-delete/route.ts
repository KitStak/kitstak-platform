/** `POST /api/retailers/bulk-delete { ids }` — per-id result; retailers on shipment orders are skipped. */
import { defineRoute } from '@/server/api/define-route';
import { bulkIds } from '@/lib/grid-defs/organization/common';
import { deleteRetailers } from '@/server/repositories/retailers';

export const POST = defineRoute({
  permission: 'settings.retailers.delete',
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => await deleteRetailers(db, auth, actor, body.ids),
});
