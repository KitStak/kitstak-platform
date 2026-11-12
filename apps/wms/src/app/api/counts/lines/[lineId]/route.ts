/** `DELETE /api/counts/lines/[lineId]` - remove a line from a Pending plan (SKU Details row Delete). */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { COUNT_PERMISSIONS as P } from '@/lib/grid-defs/counts/count-grids';
import { deleteCountLine } from '@/server/repositories/counts-ops';
import { domainCtx } from '@/server/repositories/platform-common';

export const DELETE = defineRoute({
  permission: [P.skuDelete, P.locDelete],
  params: z.object({ lineId: z.string().min(1).max(64) }),
  handler: async ({ db, auth, actor, params }) => {
    await deleteCountLine(db, domainCtx(actor, auth), auth, params.lineId);
    return { id: params.lineId };
  },
});
