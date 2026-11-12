/** `GET /api/integration-logs/items?kind=orders|products` — Orders and Shipments / Products and Inventory call logs. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { listResult } from '@/server/api/envelope';
import { listCallLogs } from '@/server/repositories/integration-logs';

export const GET = defineRoute({
  permission: 'integrations.integration_logs.view',
  query: z.object({ kind: z.enum(['orders', 'products']).default('orders') }).loose(),
  handler: async ({ db, auth, grid, query }) => {
    const q = grid();
    const { rows, total } = await listCallLogs(db, auth, query.kind, q);
    return listResult(rows, { total, page: q.page, pageSize: q.pageSize });
  },
});
