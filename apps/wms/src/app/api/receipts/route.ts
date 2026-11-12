/** `GET /api/receipts` — Receiving History (grid grammar). */
import { listResult } from '@/server/api/envelope';
import { defineRoute } from '@/server/api/define-route';
import { listReceipts } from '@/server/repositories/receipts';

export const GET = defineRoute({
  permission: 'inventory.receiving_history.view',
  handler: async ({ db, auth, grid }) => {
    const query = grid();
    const { rows, total } = await listReceipts(db, auth, query);
    return listResult(rows, { total, page: query.page, pageSize: query.pageSize });
  },
});
