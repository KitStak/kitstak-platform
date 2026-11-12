/** `GET /api/mobile-carts/[id]/change-log` — field-level history (no catalog change-log key for carts; view gates it). */
import { defineRoute } from '@/server/api/define-route';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { changeLogPageSchema, changeLogResultOrDeleted } from '@/server/repositories/locations-shared';
import { loadMobileCart } from '@/server/repositories/mobile-carts';

export const GET = defineRoute({
  permission: ['settings.mobile_carts.view', 'inventory.inventory_by_location.view'],
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: async ({ db, auth, params, query }) => {
    return await changeLogResultOrDeleted(
      db,
      auth,
      'mobile_cart',
      params.id,
      query,
      async () => await loadMobileCart(db, auth, params.id),
    );
  },
});
