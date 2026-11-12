/** `GET /api/returns/carriers?warehouseId=&clientId=` — carrier → service options with a working adapter. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { notFoundError } from '@/server/api/errors';
import { hasWarehouse } from '@/server/auth/scope';
import { idSchema } from '@/server/repositories/platform-common';
import { carrierOptions } from '@/server/repositories/returns-carriers';

export const GET = defineRoute({
  permission: [
    'fulfillment.shipment_orders.create_return_label',
    'fulfillment.shipment_orders.create_label',
    'fulfillment.packing_station.view',
  ],
  query: z.object({ warehouseId: idSchema, clientId: idSchema.optional() }),
  handler: async ({ db, auth, query }) => {
    if (!hasWarehouse(auth.scope, query.warehouseId)) throw notFoundError('Warehouse');
    return await carrierOptions(db, query.warehouseId, query.clientId);
  },
});
