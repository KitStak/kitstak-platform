/** Import handler "shipment-orders" — owned by M01 (logic in `src/server/repositories/orders-import.ts`). */
import type { ImportHandler } from '../types';
import { applyShipmentOrderRow } from '@/server/repositories/orders-import';

export const handler: ImportHandler = { configured: true, owner: 'M01', apply: applyShipmentOrderRow };
