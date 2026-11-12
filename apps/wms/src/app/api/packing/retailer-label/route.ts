/**
 * `POST /api/packing/retailer-label { orderId, reprint?, caseCount? }` — Print Actions ›
 * Create / Reprint Retailer Label (one "Retailer Label For Case" per case).
 */
import { defineRoute } from '@/server/api/define-route';
import { created } from '@/server/api/envelope';
import { printRetailerLabel, retailerLabelSchema } from '@/server/repositories/packing';
import { scopedCtx } from '@/server/repositories/returns';

export const POST = defineRoute({
  permission: [
    'fulfillment.shipment_orders.create_retailer_label',
    'fulfillment.shipment_orders.reprint_retailer_label',
  ],
  transaction: false,
  body: retailerLabelSchema,
  handler: async ({ db, auth, actor, body }) =>
    created(await printRetailerLabel(db, scopedCtx(actor, auth), body)),
});
