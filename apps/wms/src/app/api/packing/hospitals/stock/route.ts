/** `GET /api/packing/hospitals/stock?warehouseId=` — hospital locations with the stock in them. */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { listHospitals } from '@/server/repositories/packing-hospitals';
import { PACKING_PERMISSIONS, warehouseIdParam } from '@/server/repositories/packing-scan';

export const GET = defineRoute({
  permission: PACKING_PERMISSIONS.view,
  query: z.object({ warehouseId: warehouseIdParam }),
  handler: async ({ db, auth, query }) => await listHospitals(db, auth.scope, query.warehouseId),
});
