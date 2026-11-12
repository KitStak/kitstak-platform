/** `POST /api/packing/warning-ack` — the packer acknowledged the order's Packing Warning (written to its change log). */
import { defineRoute } from '@/server/api/define-route';
import { PACKING_PERMISSIONS } from '@/server/repositories/packing-scan';
import { ackWarningSchema, acknowledgeWarning } from '@/server/repositories/packing-warnings';
import { scopedCtx } from '@/server/repositories/returns';

export const POST = defineRoute({
  permission: PACKING_PERMISSIONS.view,
  body: ackWarningSchema,
  handler: async ({ db, auth, actor, body }) => await acknowledgeWarning(db, scopedCtx(actor, auth), body),
});
