/**
 * `PUT /api/packing/orders/[id]/draft` — save the in-progress pack state of an order (scanned units,
 * open / closed packages, captures, carrier choice and last quote) so reopening it resumes.
 * `DELETE /api/packing/orders/[id]/draft` — discard it (start the order over).
 * Complete Packing and Report Issue clear the draft themselves.
 */
import { defineRoute } from '@/server/api/define-route';
import { idParamsSchema } from '@/server/repositories/platform-common';
import { loadPackOrder, packContext } from '@/server/repositories/packing';
import { clearPackDraft, saveDraftSchema, savePackDraft } from '@/server/repositories/packing-drafts';
import { PACKING_PERMISSIONS } from '@/server/repositories/packing-scan';
import { scopedCtx } from '@/server/repositories/returns';

export const PUT = defineRoute({
  permission: PACKING_PERMISSIONS.execute,
  params: idParamsSchema,
  body: saveDraftSchema,
  handler: async ({ db, auth, actor, params, body }) => {
    const ctx = await packContext(db, auth.scope, params.id);
    return await savePackDraft(db, scopedCtx(actor, auth), params.id, body, {
      status: ctx.order.status,
      lines: ctx.lines.filter((l) => l.toPack > 0),
    });
  },
});

export const DELETE = defineRoute({
  permission: PACKING_PERMISSIONS.execute,
  params: idParamsSchema,
  handler: async ({ db, auth, params }) => {
    await loadPackOrder(db, auth.scope, params.id);
    await clearPackDraft(db, params.id);
    return { cleared: true };
  },
});
