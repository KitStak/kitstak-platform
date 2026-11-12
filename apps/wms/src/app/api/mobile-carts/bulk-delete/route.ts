/** `POST /api/mobile-carts/bulk-delete { ids }` — per-id result; Occupied carts are skipped. */
import { defineRoute } from '@/server/api/define-route';
import { bulkIds } from '@/lib/grid-defs/facility/common';
import { deleteMobileCarts } from '@/server/repositories/mobile-carts';

export const POST = defineRoute({
  permission: 'settings.mobile_carts.delete',
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => await deleteMobileCarts(db, auth, actor, body.ids),
});
