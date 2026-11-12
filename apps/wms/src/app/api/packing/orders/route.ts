/** `GET /api/packing/orders?warehouseId=&q=&clientId=&jobCode=&note=&expectedShipDate=` — List & Select (ready to pack). */
import { defineRoute } from '@/server/api/define-route';
import { listResult } from '@/server/api/envelope';
import { PACKING_PERMISSIONS, readyListSchema, readyToPackOrders } from '@/server/repositories/packing-scan';

export const GET = defineRoute({
  permission: PACKING_PERMISSIONS.view,
  query: readyListSchema,
  handler: async ({ db, auth, query }) => {
    const rows = await readyToPackOrders(db, auth.scope, query);
    return listResult(rows, { total: rows.length, page: 1, pageSize: rows.length });
  },
});
