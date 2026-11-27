/** `GET /api/products/:id/programs`: KitStak Projects programs that build this kit (read only, units only). */
import { PRODUCT_READ_PERMISSIONS } from '@/lib/grid-defs/products/permissions';
import { defineRoute } from '@/server/api/define-route';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { getProductPrograms } from '@/server/projects/bridge';

export const GET = defineRoute({
  permission: PRODUCT_READ_PERMISSIONS,
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => await getProductPrograms(db, auth, params.id),
});
