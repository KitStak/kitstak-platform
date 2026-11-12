/** `POST /api/packing/label` — create the shipping label of an already-packed order (retry after a carrier error). */
import { defineRoute } from '@/server/api/define-route';
import { created } from '@/server/api/envelope';
import { retryLabel, retryLabelSchema } from '@/server/repositories/packing';
import { PACKING_PERMISSIONS } from '@/server/repositories/packing-scan';
import { scopedCtx } from '@/server/repositories/returns';

export const POST = defineRoute({
  permission: PACKING_PERMISSIONS.createLabel,
  transaction: false,
  body: retryLabelSchema,
  handler: async ({ db, auth, actor, body }) => created(await retryLabel(db, scopedCtx(actor, auth), body)),
});
