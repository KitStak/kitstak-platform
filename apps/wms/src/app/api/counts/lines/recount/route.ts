/** `POST /api/counts/lines/recount` - Create Recount for counted lines `{ ids, assigneeUserId? }`. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { COUNT_PERMISSIONS as P } from '@/lib/grid-defs/counts/count-grids';
import { createRecounts } from '@/server/repositories/counts-jobs';
import { idsSchema } from '@/server/repositories/counts-ops';
import { domainCtx } from '@/server/repositories/platform-common';

export const POST = defineRoute({
  permission: [P.locRecount, P.skuRecount],
  body: idsSchema.extend({ assigneeUserId: z.string().min(1).max(64).nullish() }),
  handler: async ({ db, auth, actor, body }) =>
    await createRecounts(db, domainCtx(actor, auth), auth, body.ids, body.assigneeUserId ?? null),
});
