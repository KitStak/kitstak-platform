/** `GET /api/kits/components`: Kit Component Inventory Availability (grid grammar, live). */
import { defineRoute } from '@/server/api/define-route';
import { result } from '@/server/api/envelope';
import { listKitComponents } from '@/server/repositories/kits';
import { KIT_PERMISSIONS } from '@/server/repositories/work-orders-api';

export const GET = defineRoute({
  permission: KIT_PERMISSIONS.components,
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listKitComponents(db, auth.viewScope, query);
    return result(rows, { meta: { total, page: query.page, pageSize: query.pageSize } });
  },
});
