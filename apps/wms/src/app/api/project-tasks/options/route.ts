/** `GET /api/project-tasks/options` — Projects the user can add tasks to (+ statuses) and people to assign. */
import { defineRoute } from '@/server/api/define-route';
import { ORDER_PERMISSIONS } from '@/lib/grid-defs/orders/shipment-orders';
import { WO_PERMISSIONS } from '@/server/repositories/work-orders-api';
import { getProjectOptions } from '@/server/projects/bridge';

export const GET = defineRoute({
  permission: [ORDER_PERMISSIONS.view, WO_PERMISSIONS.view],
  handler: async ({ db, auth }) => await getProjectOptions(db, auth),
});
