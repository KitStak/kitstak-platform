/** `POST /api/monitoring/workflow-blocked/release { ids }` — Release / Unblock orders (beyond Logiwa). */
import { defineRoute } from '@/server/api/define-route';
import { bulkIds } from '@/lib/grid-defs/integrations/common';
import { releaseBlocked } from '@/server/repositories/monitoring';

export const POST = defineRoute({
  permission: ['fulfillment.shipment_orders.edit', 'automation.workflows.edit'],
  body: bulkIds,
  handler: async ({ db, auth, actor, body }) => await releaseBlocked(db, auth, actor, body.ids),
});
