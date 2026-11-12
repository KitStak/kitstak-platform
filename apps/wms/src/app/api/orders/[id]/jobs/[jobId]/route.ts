/** `DELETE /api/orders/[id]/jobs/[jobId]` — Assigned Jobs "x": removes the order from the job (tasks still pending). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { ORDER_PERMISSIONS } from '@/lib/grid-defs/orders/shipment-orders';
import { unassignJob } from '@/server/repositories/orders-commands';
import { domainCtx, idSchema } from '@/server/repositories/platform-common';

export const DELETE = defineRoute({
  permission: ORDER_PERMISSIONS.jobs,
  params: z.object({ id: idSchema, jobId: idSchema }),
  handler: async ({ db, auth, actor, params }) =>
    await unassignJob(db, domainCtx(actor, auth), params.id, params.jobId),
});
