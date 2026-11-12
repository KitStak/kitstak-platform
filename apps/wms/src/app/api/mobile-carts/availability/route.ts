/** `GET /api/mobile-carts/availability?warehouseId=&code=&excludeId=` — is the code still free? (wizard step 1 pre-check). */
import { defineRoute } from '@/server/api/define-route';
import { availabilityQuerySchema, checkAvailability } from '@/server/repositories/locations-availability';

export const GET = defineRoute({
  permission: ['settings.mobile_carts.create', 'settings.mobile_carts.edit'],
  query: availabilityQuerySchema,
  handler: async ({ db, auth, query }) => await checkAvailability(db, auth, 'mobile_cart', query),
});
