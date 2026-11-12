/** `GET /api/shipments/history` — Shipment History from the ledger (grid grammar). */
import { defineRoute } from '@/server/api/define-route';
import { listResult } from '@/server/api/envelope';
import { listShipmentHistory } from '@/server/repositories/shipping-history';

export const GET = defineRoute({
  permission: 'fulfillment.shipment_history.view',
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listShipmentHistory(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
