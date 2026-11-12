/**
 * Import handler "po-serials" (owner M05): Import PO Serial Numbers. Each row pre-advises one
 * serial on the first line of the SKU on the PO that still has room (one serial per ordered
 * unit). Rules and the change log live in `purchase-orders-serials.ts`.
 */
import { domainCtx } from '@/server/repositories/platform-common';
import { preAdviseSerial } from '@/server/repositories/purchase-orders-serials';
import type { ImportHandler, ImportRowValues } from '../types';

export const handler: ImportHandler = {
  configured: true,
  owner: 'M05',
  async apply(ctx, row: ImportRowValues) {
    const result = await preAdviseSerial(ctx.db, domainCtx(ctx.actor, ctx.auth), ctx.auth.scope, {
      poCode: row.poCode,
      sku: row.sku,
      serial: row.serialNumber,
    });
    return {
      entityId: result.purchaseOrderId,
      message: `Serial ${String(row.serialNumber ?? '').trim()} added to ${result.code} (${result.sku})`,
    };
  },
};
