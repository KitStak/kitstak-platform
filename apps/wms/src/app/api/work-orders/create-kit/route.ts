/** `POST /api/work-orders/create-kit`: build kits (ledger Kitting + Kitting receipt). */
import { defineRoute } from '@/server/api/define-route';
import { forbiddenError } from '@/server/api/errors';
import { can } from '@/server/auth/permissions';
import { createKitSchema } from '@/lib/grid-defs/work-orders/work-order-model';
import { planningDeniedForRoles } from '@/lib/grid-defs/work-orders/wo-planning';
import { getWorkOrderRow } from '@/server/repositories/work-orders';
import { WO_PERMISSIONS, woCtx } from '@/server/repositories/work-orders-api';
import { createKit } from '@/server/repositories/work-orders-commands';

export const POST = defineRoute({
  permission: WO_PERMISSIONS.createKit,
  body: createKitSchema,
  handler: async ({ db, auth, actor, body }) => {
    // "Complete pending picks and build" posts real Picking moves on behalf of the floor:
    // only planners (not operator/viewer-only users) who may run picking operations.
    if (
      body.completePendingPicks &&
      (!can(auth, WO_PERMISSIONS.picking) || planningDeniedForRoles(auth.roleKeys))
    ) {
      throw forbiddenError(
        'Only a supervisor with Picking/Job Operations permission can complete pending picks from Create Kit',
      );
    }
    const res = await createKit(db, woCtx(actor, auth), body);
    return { ...res, workOrder: await getWorkOrderRow(db, auth.scope, res.workOrderId) };
  },
});
