/** `GET /api/work-orders/:id/pulse`: KitStak Pulse job profit for this work order. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { getWorkOrderPulse } from '@/server/pulse/bridge';
import { WO_PERMISSIONS } from '@/server/repositories/work-orders-api';

export const GET = defineRoute({
  permission: WO_PERMISSIONS.view,
  params: z.object({ id: z.string().trim().min(1).max(64) }),
  handler: async ({ db, auth, params }) => await getWorkOrderPulse(db, auth, params.id),
});
