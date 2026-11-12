/** `GET /api/warehouses/[id]/change-log` — field-level history of one warehouse. */
import { defineRoute } from '@/server/api/define-route';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { changeLogPageSchema, changeLogResultOrDeleted } from '@/server/repositories/locations-shared';
import { loadWarehouse } from '@/server/repositories/warehouses';

export const GET = defineRoute({
  // One rule across M10: whoever can view the record can view its change log.
  permission: ['settings.warehouse.view', 'inventory.inventory_by_location.view'],
  params: idParamsSchema,
  query: changeLogPageSchema,
  handler: async ({ db, auth, params, query }) => {
    return await changeLogResultOrDeleted(
      db,
      auth,
      'warehouse',
      params.id,
      query,
      async () => await loadWarehouse(db, auth, params.id),
    );
  },
});
