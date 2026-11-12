/** `POST /api/orders/bulk/labels` `{ action: create|void|reprint|return|void-return, ids }` — per-order outcomes. */
import { defineRoute } from '@/server/api/define-route';
import { forbiddenError } from '@/server/api/errors';
import { can } from '@/server/auth/permissions';
import { ORDER_PERMISSIONS } from '@/lib/grid-defs/orders/shipment-orders';
import { labelBulkSchema, runLabelBulk, type LabelAction } from '@/server/repositories/orders-labels';
import { domainCtx } from '@/server/repositories/platform-common';

const PERMISSION_FOR: Readonly<Record<LabelAction, string>> = {
  create: ORDER_PERMISSIONS.createLabel,
  void: ORDER_PERMISSIONS.voidLabel,
  reprint: ORDER_PERMISSIONS.reprintLabel,
  return: ORDER_PERMISSIONS.createReturnLabel,
  'void-return': ORDER_PERMISSIONS.voidLabel,
};

export const POST = defineRoute({
  permission: Object.values(PERMISSION_FOR),
  body: labelBulkSchema,
  transaction: false,
  handler: async ({ db, auth, actor, body }) => {
    if (!can(auth, PERMISSION_FOR[body.action])) throw forbiddenError();
    return runLabelBulk(db, domainCtx(actor, auth), body);
  },
});
